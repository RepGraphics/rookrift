import {hostingCapabilities} from '../shared/hosting-providers';
import {PLANS} from '../server/plans';
import {WORKFLOW_PRESETS,ACTIVE_RUNS} from '../shared/workflows';
import {nextRun} from '../shared/scheduling';
export function ensureDemoWorkflows(data){
  data.workflow_data??={definitions:data.servers.some(s=>s.id==='d1')?[{id:'workflow-archive',name:'Verified daily archive',server_id:'d1',enabled:false,trigger_type:'manual',interval_minutes:1440,days:[0,1,2,3,4,5,6],start_time:'04:00',time_zone:'Europe/London',cooldown_minutes:60,steps:structuredClone(WORKFLOW_PRESETS[1].steps),has_webhook_key:false,created_at:Date.now(),updated_at:Date.now()}]:[],runs:[]};
  return data.workflow_data;
}
export function demoWorkflowRequest(data,path,method='GET',body){
  const state=ensureDemoWorkflows(data),now=Date.now(),limit=PLANS[data.workspace.plan].workflows;
  const flow=id=>{const row=state.definitions.find(f=>f.id===id);if(!row)throw new Error('Workflow not found.');return row;};
  const run=id=>{const row=state.runs.find(r=>r.id===id);if(!row)throw new Error('Run not found.');return row;};
  const active=server=>state.runs.find(r=>r.server_id===server&&ACTIVE_RUNS.includes(r.status));
  if(path==='/workflows'&&method==='GET')return{limit,definitions:state.definitions.map((f,i)=>({...f,paused:i>=limit})),runs:state.runs};
  const match=path.match(/^\/workflows(?:\/([^/]+)(?:\/(run|toggle|webhook-key))?)?$/);
  if(match){const id=match[1],action=match[2];
    if(!action&&method==='DELETE'){const row=flow(id);if(active(row.server_id)?.workflow_id===id)throw new Error('Cancel the active run before deleting this workflow.');state.definitions=state.definitions.filter(f=>f.id!==id);return{ok:true};}
    if(!action){if(!id&&state.definitions.length>=limit)throw new Error('Workflow allowance reached.');if(id&&state.runs.some(r=>r.workflow_id===id&&ACTIVE_RUNS.includes(r.status)))throw new Error('Cancel the active run before editing this workflow.');const server=data.servers.find(s=>s.id===body.server_id);if(body.steps.some(step=>step.type==='restart')&&body.confirmation!==server?.name)throw new Error('Type the exact game server name to authorise restarts.');if(body.steps.some(step=>['backup','wait_backup','restart'].includes(step.type))&&body.steps.some(step=>['backup','wait_backup','restart'].includes(step.type)&&!data.hosting_links.some(link=>link.server_id===body.server_id&&hostingCapabilities(link.provider)[step.type==='restart'?'restart':'backups'])))throw new Error('Connect hosting before using hosting steps.');const row={...body,id:id||crypto.randomUUID(),has_webhook_key:id?flow(id).has_webhook_key:false,created_at:id?flow(id).created_at:now,updated_at:now,next_run:['weekly','interval'].includes(body.trigger_type)?nextRun({...body,schedule_type:body.trigger_type}):null};delete row.confirmation;if(id)Object.assign(flow(id),row);else state.definitions.push(row);return row;}
    const row=flow(id);
    if(action==='toggle'){row.enabled=body.enabled;if(!row.enabled)for(const r of state.runs.filter(r=>r.workflow_id===id&&ACTIVE_RUNS.includes(r.status))){r.status='cancelled';r.finished_at=now;}return{ok:true};}
    if(action==='webhook-key'){row.has_webhook_key=true;return{secret:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')};}
    if(action==='run'){
      if(!row.enabled)throw new Error('Enable this workflow before starting it.');if(state.definitions.indexOf(row)>=limit)throw new Error('This workflow is paused by the current plan.');const server=data.servers.find(s=>s.id===row.server_id);if(server.maintenance)throw new Error('The server is in maintenance mode.');if(active(server.id))throw new Error('Another workflow is active for this server.');if(row.last_started_at&&now-row.last_started_at<row.cooldown_minutes*60000)throw new Error('This workflow is cooling down.');if(row.steps.some(step=>step.type==='restart')&&body?.confirmation!==server.name)throw new Error('Type the exact server name to confirm the restart.');const r={id:crypto.randomUUID(),workflow_id:id,server_id:server.id,name:row.name,trigger_type:'manual',actor:data.user.name,status:'queued',steps:row.steps.map(step=>({...step,status:'pending'})),next_step:0,next_step_at:now,created_at:now,updated_at:now,cancel_requested:false};state.runs.unshift(r);row.last_started_at=now;return{run_id:r.id};
    }
  }
  const runMatch=path.match(/^\/workflow-runs\/([^/]+)\/(cancel|advance)$/);
  if(runMatch){const r=run(runMatch[1]);if(!ACTIVE_RUNS.includes(r.status))throw new Error('This run has already finished.');if(runMatch[2]==='cancel'){r.status='cancelled';r.cancel_requested=true;r.finished_at=now;return{ok:true};}
    const step=r.steps[r.next_step],server=data.servers.find(s=>s.id===r.server_id);step.started_at=now;step.finished_at=now;step.status='succeeded';
    if(step.type==='wait')step.detail='Simulated timer advanced.';
    else if(step.type==='restart'){server.status='unknown';step.detail='Simulated provider restart accepted.';}
    else if(step.type==='verify_online'){server.status='online';server.last_checked=now;step.detail='Simulated RCON recovery verified.';}
    else if(step.type==='backup'){step.backup_id=crypto.randomUUID();data.backups??={};data.backups[server.id]??=[];data.backups[server.id].unshift({id:step.backup_id,name:r.name,status:'in progress',created_at:new Date(now).toISOString(),completed_at:null,bytes:0});step.detail='Simulated backup request accepted.';}
    else if(step.type==='wait_backup'){const prior=r.steps.slice(0,r.next_step).reverse().find(s=>s.backup_id);if(!prior)throw new Error('No preceding backup reference.');const backup=data.backups?.[server.id]?.find(b=>b.id===prior.backup_id);if(backup){backup.status='completed';backup.completed_at=new Date(now).toISOString();backup.bytes=1024**3;}step.detail='Simulated provider completion verified.';}
    else step.detail='Simulated '+(step.type==='notify'?'staff notification.':step.type==='save'?'world save acknowledged.':'announcement acknowledged.');
    r.next_step++;r.updated_at=now;if(r.next_step>=r.steps.length){r.status='succeeded';r.finished_at=now;}return r;
  }
  throw new Error('Workflow action unavailable.');
}
