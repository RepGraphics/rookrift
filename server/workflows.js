import {assertHostingCapability} from '../shared/hosting-providers.js';
import {randomUUID,randomBytes,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {hash} from './crypto.js';
import {effectivePlan,assertCapacity} from './plans.js';
import {audit} from './db.js';
import {maintenanceState,notify,renderAnnouncement} from './operations-state.js';
import {nextRun,validTimeZone} from '../shared/scheduling.js';
import {ACTIVE_RUNS} from '../shared/workflows.js';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const message=z.string().trim().min(1).max(300).refine(value=>![...value.matchAll(/\{([^{}]+)\}/g)].some(([,key])=>!['server','map','players','cluster'].includes(key)),'Use {server}, {map}, {players} or {cluster} placeholders.');
const stepSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('broadcast'),message}).strict(),z.object({type:z.literal('notify'),message}).strict(),
  z.object({type:z.literal('wait'),seconds:z.coerce.number().int().min(5).max(3600)}).strict(),
  z.object({type:z.literal('verify_online'),timeout_minutes:z.coerce.number().int().min(1).max(30)}).strict(),
  z.object({type:z.literal('wait_backup'),timeout_minutes:z.coerce.number().int().min(1).max(120)}).strict(),
  ...['save','backup','restart'].map(type=>z.object({type:z.literal(type)}).strict())
]);
export const workflowSchema=z.object({
  name:z.string().trim().min(2).max(60),server_id:z.string().uuid(),enabled:z.boolean().default(true),
  trigger_type:z.enum(['manual','interval','weekly','outage','recovery','webhook']).default('manual'),
  interval_minutes:z.coerce.number().int().min(15).max(10080).default(60),
  days:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days=>new Set(days).size===days.length).default([0,1,2,3,4,5,6]),
  start_time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default('04:00'),time_zone:z.string().max(80).refine(validTimeZone).default('UTC'),
  cooldown_minutes:z.coerce.number().int().min(1).max(1440).default(60),steps:z.array(stepSchema).min(1).max(12),confirmation:z.string().max(60).optional()
}).strict().superRefine((value,ctx)=>{
  if(value.trigger_type==='outage'&&value.cooldown_minutes<60)ctx.addIssue({code:'custom',message:'Outage workflows need a cooldown of at least 60 minutes.'});
  if(value.steps.reduce((sum,step)=>sum+(step.seconds||0),0)>21600)ctx.addIssue({code:'custom',message:'Total waits cannot exceed six hours.'});
  let backup=false;for(const step of value.steps){if(step.type==='backup')backup=true;if(step.type==='wait_backup'&&!backup)ctx.addIssue({code:'custom',message:'Add a backup request before verifying its completion.'});}
});
const definition=row=>{if(!row)return null;const {webhook_hash,...safe}=row;return{...safe,enabled:Boolean(row.enabled),days:JSON.parse(row.days),steps:JSON.parse(row.steps),has_webhook_key:Boolean(webhook_hash)};};
const runJson=row=>({...row,cancel_requested:Boolean(row.cancel_requested),steps:JSON.parse(row.steps)});
const scheduled=(workflow,time)=>['interval','weekly'].includes(workflow.trigger_type)?nextRun({...workflow,schedule_type:workflow.trigger_type},time):null;
export async function assertWorkflowIdle(db,serverId,exceptRun=null,exceptConfig=null,allowUncertain=false){
  const row=await db.prepare("SELECT id FROM workflow_runs WHERE server_id=? AND status IN ('queued','running','waiting') AND (?::text IS NULL OR id<>?) LIMIT 1").get(serverId,exceptRun,exceptRun);
  if(row)fail('Cancel the active workflow before changing this server or requesting a separate hosting action.',409);
  if(await db.prepare("SELECT id FROM config_applications WHERE server_id=? AND (status IN ('applying','rolling_back') OR (status='uncertain' AND ?=0)) AND (?::text IS NULL OR id<>?) LIMIT 1").get(serverId,Number(allowUncertain),exceptConfig,exceptConfig))fail('A configuration operation is active or uncertain. Verify its outcome or roll it back before another change.',409);
}
export function createWorkflows(db,service,operations,{now=Date.now,send=async()=>false}={}){
  let ticking=false,stopping=false,lastPruned=-Infinity;const processing=new Set();
  const workspace=id=>db.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
  const owned=async(table,ws,id)=>{const row=await db.prepare(`SELECT * FROM ${table} WHERE workspace_id=? AND id=?`).get(ws,id);if(!row)fail('Workflow record not found.',404);return row;};
  async function entitled(ws,id){const rows=await db.prepare('SELECT id FROM workflows WHERE workspace_id=? ORDER BY created_at,id').all(ws.id);if(rows.findIndex(row=>row.id===id)>=effectivePlan(ws).workflows)fail('This workflow is paused by the current plan.',403);}
  async function finish(run,status,detail){const steps=JSON.parse(run.steps);if(detail){const step=steps[run.next_step];if(step&&step.status!=='succeeded'){step.status=status==='cancelled'?'cancelled':step.status==='executing'?'uncertain':'failed';step.detail=String(detail).slice(0,1000);step.finished_at=now();}}
    await db.prepare('UPDATE workflow_runs SET status=?,steps=?,next_step=?,updated_at=?,finished_at=? WHERE id=?').run(status,JSON.stringify(steps),run.next_step,now(),now(),run.id);
    await notify(db,run.workspace_id,'Workflow '+status,`${run.name} · ${detail||'All steps completed.'}`,'failed'===status?'error':'info','workflows',run.id+':'+status);
  }
  async function enqueue(ws,id,{actor='Automation',source=null,manual=false,confirmation}={}){
    return db.withWorkspaceLock(ws,async()=>{
      const flow=await owned('workflows',ws,id),community=await workspace(ws);await entitled(community,id);
      if(!flow.enabled)fail('Enable this workflow before starting it.',409);
      const server=await service.getServer(ws,flow.server_id);if((await maintenanceState(db,server,now())).in_maintenance)fail('This server is in maintenance mode.',409);
      const steps=JSON.parse(flow.steps);if(manual&&steps.some(step=>step.type==='restart')&&confirmation!==server.name)fail('Type the exact game server name to confirm a restart workflow.');
      if(source){const previous=await db.prepare('SELECT run_id FROM workflow_events WHERE workflow_id=? AND source_key=?').get(id,source)||await db.prepare('SELECT id AS run_id FROM workflow_runs WHERE workflow_id=? AND source_key=?').get(id,source);if(previous)return{run_id:previous.run_id,duplicate:true};}
      if(flow.last_started_at!==null&&now()-flow.last_started_at<flow.cooldown_minutes*60000)fail('This workflow is cooling down. Wait before starting it again.',409);
      if(flow.trigger_type==='outage'&&!manual){const recent=await db.prepare("SELECT count(*) AS n,MAX(created_at) AS latest FROM workflow_runs WHERE server_id=? AND trigger_type='outage' AND created_at>?").get(server.id,now()-86400000);if(recent.n>=3||recent.latest!==null&&now()-recent.latest<3600000)fail('Automatic outage runs require a server-wide one-hour cooldown and are limited to three per 24 hours.',409);}
      await assertWorkflowIdle(db,server.id);
      const runId=randomUUID(),snapshots=steps.map(step=>({...step,status:'pending'}));
      await db.prepare("INSERT INTO workflow_runs(id,workspace_id,workflow_id,server_id,name,trigger_type,actor,source_key,status,steps,next_step_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'queued',?,?,?,?)").run(runId,ws,id,server.id,flow.name,manual?'manual':flow.trigger_type,String(actor).slice(0,100),source,JSON.stringify(snapshots),now(),now(),now());
      if(source)await db.prepare('INSERT INTO workflow_events VALUES(?,?,?,?)').run(id,source,runId,now());
      await db.prepare('UPDATE workflows SET last_started_at=? WHERE id=?').run(now(),id);
      await audit(db,ws,'Workflow queued',`${flow.name} · ${server.name} · ${actor}`,'info',server.id);return{run_id:runId,duplicate:false};
    });
  }
  async function processRun(id){if(processing.has(id))return;processing.add(id);let run;
    try{
      run=await db.prepare('SELECT * FROM workflow_runs WHERE id=?').get(id);if(!run||!ACTIVE_RUNS.includes(run.status)||!run.cancel_requested&&run.next_step_at>now())return;
      const ws=await workspace(run.workspace_id),flow=run.workflow_id&&await db.prepare('SELECT * FROM workflows WHERE id=?').get(run.workflow_id);
      if(run.cancel_requested||!flow?.enabled){await finish(run,'cancelled','Cancellation requested or workflow disabled.');return;}
      await entitled(ws,flow.id);const server=await service.getServer(ws.id,run.server_id);if((await maintenanceState(db,server,now())).in_maintenance){await finish(run,'cancelled','Server entered maintenance mode.');return;}
      const steps=JSON.parse(run.steps),step=steps[run.next_step];if(!step){await finish(run,'succeeded');return;}
      if(step.status==='executing'){await finish(run,'failed','Previous execution outcome is uncertain. Inspect server/provider state before a new run.');return;}
      const started=step.started_at??now();let complete=true,result;
      if(step.type==='wait'){
        step.started_at=started;step.until??=now()+step.seconds*1000;if(now()<step.until){step.status='waiting';await db.prepare("UPDATE workflow_runs SET status='waiting',steps=?,next_step_at=?,updated_at=? WHERE id=?").run(JSON.stringify(steps),step.until,now(),id);return;}result={detail:'Wait completed.'};
      }else if(step.type==='verify_online'||step.type==='wait_backup'){
        step.started_at=started;step.deadline??=now()+step.timeout_minutes*60000;step.status='waiting';
        try{
          if(step.type==='verify_online'){
            const restart=steps.slice(0,run.next_step).reverse().find(value=>value.type==='restart'&&value.status==='succeeded');
            if(restart){const resources=await operations.hostingResources(ws.id,server.id);step.observed_stopped=Boolean(step.observed_stopped||['offline','starting','stopping'].includes(resources.state));const reset=restart.before_uptime_ms>0&&resources.uptime_ms>0&&resources.uptime_ms<restart.before_uptime_ms;complete=resources.state==='running'&&(['offline','starting','stopping'].includes(restart.before_state)||step.observed_stopped||reset);if(!complete)step.detail='Waiting for provider restart evidence before checking RCON.';}
            if(complete){await service.action(ws.id,server.id,'status','','Workflow recovery check');result={detail:restart?'Provider restart evidence and authenticated RCON recovery verified.':'Authenticated RCON connection verified.'};}
          }
          else {const backup=steps.slice(0,run.next_step).reverse().find(value=>value.type==='backup'&&value.backup_id);if(!backup)fail('No backup reference was returned by the provider.');const status=await operations.hostingBackupStatus(ws.id,server.id,backup.backup_id);if(status.status==='failed')fail('The hosting provider reported backup failure.',422);if(status.status!=='completed'){complete=false;}else result={detail:'The hosting provider confirmed backup completion.',backup_id:backup.backup_id};}
        }catch(error){if(error.status===422)throw error;complete=false;step.detail='Verification is pending; the server/provider did not confirm readiness.';}
        if(!complete){if(now()>=step.deadline)fail('Verification timed out. Later workflow actions were stopped.');await db.prepare("UPDATE workflow_runs SET status='waiting',steps=?,next_step_at=?,updated_at=? WHERE id=?").run(JSON.stringify(steps),Math.min(now()+30000,step.deadline),now(),id);return;}
      }else{
        if(step.type==='restart'){const before=await operations.hostingResources(ws.id,server.id);step.before_state=before.state;step.before_uptime_ms=before.uptime_ms||0;step.restart_requested_at=now();}
        // Commit the execution marker BEFORE any external side effect. Ambiguous actions are never replayed.
        step.status='executing';step.started_at=started;run.steps=JSON.stringify(steps);await db.prepare("UPDATE workflow_runs SET status='running',steps=?,updated_at=? WHERE id=?").run(run.steps,now(),id);
        try{
          if(step.type==='broadcast'||step.type==='save'){await service.action(ws.id,server.id,step.type,step.message?renderAnnouncement(step.message,server):'',`Workflow: ${run.name}`);result={detail:step.type==='save'?'World save acknowledged.':'Announcement acknowledged.'};}
          else if(step.type==='backup'||step.type==='restart'){const response=await operations.hostingAction(ws.id,server.id,{action:step.type,confirmation:server.name},{workflowRun:id});result={detail:step.type==='backup'?'Backup request accepted; completion is a separate step.':'Restart request accepted; recovery is a separate step.',...(response.backup_id?{backup_id:response.backup_id}:{})};}
          else if(step.type==='notify'){const body=renderAnnouncement(step.message,server);await notify(db,ws.id,'Workflow update',body,'info','workflows',id+':'+run.next_step);let delivered=false;try{delivered=await send(ws,body);}catch{}result={detail:delivered?'Staff notified in the dashboard and Discord.':'Staff notified in the dashboard. Discord delivery was unavailable.'};}
        }catch(error){
          if(error.code==='SERVER_BUSY'){step.busy_deadline??=now()+300000;if(now()<step.busy_deadline){step.status='pending';step.detail='Waiting for an existing command to finish; this step has not sent a command.';await db.prepare("UPDATE workflow_runs SET status='waiting',steps=?,next_step_at=?,updated_at=? WHERE id=?").run(JSON.stringify(steps),now()+5000,now(),id);return;}}
          step.status='failed';step.detail=error.status?error.message:'The external action failed or its acknowledgement is uncertain. Inspect server/provider state before another run.';step.finished_at=now();run.steps=JSON.stringify(steps);await finish(run,'failed',step.detail);return;}
      }
      Object.assign(step,result,{status:'succeeded',finished_at:now()});run.steps=JSON.stringify(steps);run.next_step++;
      const current=await db.prepare('SELECT cancel_requested FROM workflow_runs WHERE id=?').get(id);
      if(run.next_step>=steps.length){await finish(run,'succeeded');return;}
      if(current.cancel_requested){await finish(run,'cancelled','Cancellation requested; remaining actions were stopped.');return;}
      await db.prepare("UPDATE workflow_runs SET status='queued',steps=?,next_step=?,next_step_at=?,updated_at=? WHERE id=?").run(run.steps,run.next_step,now(),now(),id);
    }catch(error){if(run)await finish(run,'failed',error.status?error.message:'The workflow stopped because a dependency was unavailable. Inspect its history before retrying.');else throw error;}
    finally{processing.delete(id);}
  }
  const api={
    async detail(ws,id){return runJson(await owned('workflow_runs',ws,id));},
    async view(ws,scope=null){const community=await workspace(ws),rows=await db.prepare('SELECT * FROM workflows WHERE workspace_id=? ORDER BY created_at,id').all(ws),visible=id=>scope===null||scope.includes(id);return{limit:effectivePlan(community).workflows,definitions:rows.map((row,index)=>({...definition(row),paused:index>=effectivePlan(community).workflows})).filter(row=>visible(row.server_id)),runs:(await db.prepare("SELECT * FROM (SELECT * FROM workflow_runs WHERE workspace_id=? AND status IN ('queued','running','waiting') UNION ALL (SELECT * FROM workflow_runs WHERE workspace_id=? AND status NOT IN ('queued','running','waiting') ORDER BY created_at DESC LIMIT 200)) visible_runs ORDER BY created_at DESC").all(ws,ws)).filter(row=>visible(row.server_id)).map(runJson)};},
    async save(ws,id,input,actor={name:'Administrator'}){const value=workflowSchema.parse(input);return db.withWorkspaceLock(ws,async()=>{
      const server=await service.getServer(ws,value.server_id);if(value.steps.some(step=>step.type==='restart')&&value.confirmation!==server.name)fail('Type the exact game server name to authorise restart actions.');
      if(value.steps.some(step=>['restart','backup','wait_backup'].includes(step.type))){const connection=await db.prepare('SELECT provider FROM hosting_connections WHERE server_id=? AND workspace_id=?').get(server.id,ws);if(!connection)fail('Connect a verified hosting provider before adding hosting steps.');if(value.steps.some(step=>['backup','wait_backup'].includes(step.type)))assertHostingCapability(connection.provider,'backups');if(value.steps.some(step=>step.type==='restart'))assertHostingCapability(connection.provider,'restart');}
      if(id){await owned('workflows',ws,id);if(await db.prepare("SELECT id FROM workflow_runs WHERE workflow_id=? AND status IN ('queued','running','waiting') LIMIT 1").get(id))fail('Cancel the active run before editing this workflow.',409);}
      else{assertCapacity(await workspace(ws),(await db.prepare('SELECT count(*) AS n FROM workflows WHERE workspace_id=?').get(ws)).n,'workflows');id=randomUUID();}
      const next=scheduled(value,now());await db.prepare('INSERT INTO workflows(id,workspace_id,server_id,name,enabled,trigger_type,interval_minutes,days,start_time,time_zone,cooldown_minutes,steps,next_run,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET server_id=excluded.server_id,name=excluded.name,enabled=excluded.enabled,trigger_type=excluded.trigger_type,interval_minutes=excluded.interval_minutes,days=excluded.days,start_time=excluded.start_time,time_zone=excluded.time_zone,cooldown_minutes=excluded.cooldown_minutes,steps=excluded.steps,next_run=excluded.next_run,updated_at=excluded.updated_at').run(id,ws,server.id,value.name,Number(value.enabled),value.trigger_type,value.interval_minutes,JSON.stringify(value.days),value.start_time,value.time_zone,value.cooldown_minutes,JSON.stringify(value.steps),next,now(),now());
      await audit(db,ws,'Workflow saved',`${value.name} · ${actor.name}`,'info',server.id);return definition(await owned('workflows',ws,id));
    });},
    async toggle(ws,id,enabled){if(typeof enabled!=='boolean')fail('Choose whether the workflow is enabled.');return db.withWorkspaceLock(ws,async()=>{const row=await owned('workflows',ws,id);if(enabled){await entitled(await workspace(ws),id);await service.getServer(ws,row.server_id);}await db.prepare('UPDATE workflows SET enabled=?,next_run=?,updated_at=? WHERE id=?').run(Number(enabled),enabled?scheduled({...row,days:JSON.parse(row.days)},now()):row.next_run,now(),id);if(!enabled)await db.prepare("UPDATE workflow_runs SET cancel_requested=1,next_step_at=? WHERE workflow_id=? AND status IN ('queued','running','waiting')").run(now(),id);await audit(db,ws,enabled?'Workflow enabled':'Workflow disabled',row.name,'info',row.server_id);return{ok:true};});},
    async remove(ws,id){return db.withWorkspaceLock(ws,async()=>{const row=await owned('workflows',ws,id);if(await db.prepare("SELECT 1 FROM workflow_runs WHERE workflow_id=? AND status IN ('queued','running','waiting')").get(id))fail('Cancel and finish the active run before deleting this workflow.',409);await db.prepare('DELETE FROM workflows WHERE id=?').run(id);await audit(db,ws,'Workflow removed',row.name,'info',row.server_id);return{ok:true};});},
    start:(ws,id,input,actor)=>enqueue(ws,id,{manual:true,actor:actor?.name||'Administrator',confirmation:input?.confirmation}),
    async cancel(ws,id,actor={name:'Administrator'}){const row=await owned('workflow_runs',ws,id);if(!ACTIVE_RUNS.includes(row.status))fail('This workflow run has already finished.',409);await db.prepare('UPDATE workflow_runs SET cancel_requested=1,next_step_at=? WHERE id=?').run(now(),id);await audit(db,ws,'Workflow cancellation requested',`${row.name} · ${actor.name}`,'info',row.server_id);return{ok:true};},
    async rotateKey(ws,id){const row=await owned('workflows',ws,id);if(row.trigger_type!=='webhook')fail('Choose a webhook trigger first.');const secret=randomBytes(32).toString('hex');await db.prepare('UPDATE workflows SET webhook_hash=? WHERE id=?').run(hash(secret),id);await audit(db,ws,'Workflow webhook key rotated',row.name,'info',row.server_id);return{secret};},
    async webhook(id,authorization,input){const row=await db.prepare('SELECT * FROM workflows WHERE id=?').get(id),secret=typeof authorization==='string'&&authorization.startsWith('Bearer ')?authorization.slice(7):'';if(!row?.webhook_hash||row.trigger_type!=='webhook'||secret.length!==64||!timingSafeEqual(Buffer.from(hash(secret),'hex'),Buffer.from(row.webhook_hash,'hex')))fail('Webhook not found or credentials invalid.',404);const value=z.object({event_id:z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/)}).strict().parse(input);return enqueue(row.workspace_id,id,{actor:'Authenticated webhook',source:'hook:'+value.event_id});},
    async recover(){for(const row of await db.prepare("SELECT * FROM workflow_runs WHERE status IN ('queued','running','waiting')").all()){if(JSON.parse(row.steps).some(step=>step.status==='executing'))await finish(row,'failed','Runtime restarted during an external action. Its outcome is uncertain; no command was replayed.');}},
    async tick(){if(ticking||stopping)return;ticking=true;try{
      const definitions=await db.prepare("SELECT * FROM workflows WHERE enabled=1 AND ((trigger_type IN ('interval','weekly') AND next_run<=?) OR trigger_type IN ('outage','recovery')) ORDER BY created_at,id").all(now());
      for(const flow of definitions){try{
        if(['interval','weekly'].includes(flow.trigger_type)&&flow.next_run<=now()){
          await db.withWorkspaceLock(flow.workspace_id,async()=>{const fresh=await owned('workflows',flow.workspace_id,flow.id);if(!fresh.enabled||fresh.next_run>now())return;await db.prepare('UPDATE workflows SET next_run=? WHERE id=?').run(nextRun({...fresh,schedule_type:fresh.trigger_type},now()),fresh.id);try{await enqueue(fresh.workspace_id,fresh.id,{source:'schedule:'+fresh.next_run});}catch(error){if(!error.status)throw error;}});
        }else if(['outage','recovery'].includes(flow.trigger_type)){
          const eventColumn=flow.trigger_type==='recovery'?'resolved_at':'opened_at';
          const incidents=await db.prepare(`SELECT * FROM incidents WHERE server_id=? AND workspace_id=? AND ${eventColumn}>=? AND ${eventColumn}>=? ORDER BY ${eventColumn} LIMIT 20`).all(flow.server_id,flow.workspace_id,flow.updated_at,now()-86400000);
          for(const incident of incidents)if((flow.trigger_type==='outage'&&!incident.resolved_at)||(flow.trigger_type==='recovery'&&incident.resolved_at))await enqueue(flow.workspace_id,flow.id,{source:flow.trigger_type+':'+incident.id});
        }
      }catch(error){if(!error.status)console.error('A workflow trigger could not be evaluated.');}}
      const due=await db.prepare("SELECT id FROM workflow_runs WHERE status IN ('queued','running','waiting') AND (next_step_at<=? OR cancel_requested=1) ORDER BY next_step_at LIMIT 40").all(now());for(let i=0;i<due.length;i+=4)await Promise.all(due.slice(i,i+4).map(row=>processRun(row.id)));
      if(now()-lastPruned>=3600000){await db.prepare('DELETE FROM workflow_events WHERE created_at<?').run(now()-30*86400000);
      await db.prepare("DELETE FROM workflow_runs r USING workspaces w WHERE r.workspace_id=w.id AND r.finished_at IS NOT NULL AND r.finished_at<?::bigint-(CASE WHEN w.subscription_status IN ('active','trialing') AND w.plan='cluster' THEN 30 WHEN w.subscription_status IN ('active','trialing') AND w.plan='tribe' THEN 7 ELSE 2 END)*86400000::bigint").run(now());lastPruned=now();}
    }finally{ticking=false;}},
    async stop(){stopping=true;while(ticking)await new Promise(resolve=>setTimeout(resolve,50));}
  };return api;
}
