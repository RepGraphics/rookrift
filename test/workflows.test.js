import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {openDatabase} from '../server/db.js';
import {createVault,hash} from '../server/crypto.js';
import {createService} from '../server/service.js';
import {createOperations} from '../server/operations.js';
import {createWorkflows} from '../server/workflows.js';
import {createApp} from '../server/app.js';
import {observeHealth} from '../server/operations-state.js';
async function fixture(t){
  const db=await openDatabase(':memory:'),vault=createVault(randomBytes(32).toString('hex'));t.after(()=>db.close());
  await db.prepare("INSERT INTO users VALUES('owner','Owner',NULL,?)").run(vault.encrypt('private-token'));
  await db.prepare("INSERT INTO workspaces(id,owner_id,plan,subscription_status,created_at) VALUES('w','owner','cluster','active',1)").run();
  let time=Date.now(),online=true,backupStatus='in progress',failCommand=null,restarted=false,statusGate=null,statusEntered=null;const calls=[],backupId=randomUUID();
  const service=createService(db,vault,async(server,key,action,message)=>{calls.push({action,message});if(action==='status'&&statusGate){statusEntered();await statusGate;}if(failCommand===action)throw Object.assign(new Error('Fixture connection unavailable.'),{status:502});if(action==='status'&&!online)throw Object.assign(new Error('RCON unreachable.'),{status:502});return{output:'OK',players:[],latency:1};});
  const server=await service.addServer('w',{name:'Island',game:'asa',map:'Island',host:'8.8.8.8',port:27020,password:'private-rcon'});
  await db.prepare('INSERT INTO hosting_connections VALUES(?,?,?,?,?,?,?)').run(server.id,'w','pterodactyl','https://panel.example.com','abcdefgh',vault.encrypt('private-key'),1);
  const hosting={resources:async()=>({state:'running',uptime_ms:restarted?1000:3600000}),action:async(connection,action)=>{calls.push({action});if(action==='restart')restarted=true;return{accepted:true,...(action==='backup'?{backup_id:backupId}:{})};},backup:async()=>({id:backupId,status:backupStatus}),backups:async()=>[]};
  const operations=createOperations(db,vault,service,hosting),options={now:()=>time,send:async()=>{calls.push({action:'discord-notify'});return true;}},engine=createWorkflows(db,service,operations,options);
  const save=(overrides={})=>engine.save('w',null,{name:'Routine',server_id:server.id,steps:[{type:'save'}],cooldown_minutes:1,...overrides},{name:'Owner'});
  const state=async id=>(await engine.view('w')).runs.find(run=>run.id===id);
  return{db,vault,service,server,operations,engine,options,calls,backupId,save,state,advance:ms=>{time+=ms;},now:()=>time,setOnline:value=>{online=value;},setBackupStatus:value=>{backupStatus=value;},fail:value=>{failCommand=value;},holdStatus(){let release;statusGate=new Promise(resolve=>{release=resolve;});const started=new Promise(resolve=>{statusEntered=resolve;});return{started,release:()=>{release();statusGate=null;}};}};
}
test('workflows execute steps in order and durable waits survive a worker restart',async t=>{
  const f=await fixture(t),flow=await f.save({steps:[{type:'broadcast',message:'Hello {server}'},{type:'wait',seconds:120},{type:'save'}]});const {run_id}=await f.engine.start('w',flow.id,{},{});
  await f.engine.tick();assert.deepEqual(f.calls.map(c=>c.action),['broadcast']);assert.equal(f.calls[0].message,'Hello Island');await f.engine.tick();assert.equal((await f.state(run_id)).status,'waiting');
  const replacement=createWorkflows(f.db,f.service,f.operations,f.options);await replacement.recover();await replacement.tick();assert.equal(f.calls.length,1);f.advance(120000);await replacement.tick();await replacement.tick();assert.deepEqual(f.calls.map(c=>c.action),['broadcast','save']);assert.equal((await f.state(run_id)).status,'succeeded');
});
test('restart workflows require provider capability and exact-name authorisation before scheduling or starting',async t=>{
  const f=await fixture(t);await assert.rejects(f.save({steps:[{type:'restart'}]}),/exact game server name/);const flow=await f.save({steps:[{type:'restart'},{type:'verify_online',timeout_minutes:5}],confirmation:'Island'});
  await assert.rejects(f.engine.start('w',flow.id,{confirmation:'Wrong'},{}),/exact game server/);const {run_id}=await f.engine.start('w',flow.id,{confirmation:'Island'},{});await f.engine.tick();await f.engine.tick();assert.deepEqual(f.calls.map(c=>c.action),['restart','status']);assert.equal((await f.state(run_id)).status,'succeeded');
  await f.db.prepare('DELETE FROM hosting_connections WHERE server_id=?').run(f.server.id);await assert.rejects(f.save({steps:[{type:'backup'}]}),/verified hosting/);
});
test('an old process that still answers RCON cannot complete a restart until provider restart evidence appears',async t=>{
  const f=await fixture(t);let newProcess=false;f.operations.hostingResources=async()=>({state:'running',uptime_ms:newProcess?1000:3600000});const flow=await f.save({steps:[{type:'restart'},{type:'verify_online',timeout_minutes:5}],confirmation:'Island'}),{run_id}=await f.engine.start('w',flow.id,{confirmation:'Island'},{});await f.engine.tick();await f.engine.tick();assert.equal((await f.state(run_id)).status,'waiting');assert.deepEqual(f.calls.map(call=>call.action),['restart']);f.advance(30000);await f.engine.tick();assert.equal((await f.state(run_id)).status,'waiting');newProcess=true;f.advance(30000);await f.engine.tick();assert.equal((await f.state(run_id)).status,'succeeded');assert.deepEqual(f.calls.map(call=>call.action),['restart','status']);
});
test('active workflows reserve legacy automations and planned restarts suppress false outage alerts',async t=>{
  const f=await fixture(t),task=await f.service.addSchedule('w',{name:'Legacy save',server_id:f.server.id,action:'save',interval_minutes:60}),flow=await f.save({steps:[{type:'restart'},{type:'verify_online',timeout_minutes:5}],confirmation:'Island'}),{run_id}=await f.engine.start('w',flow.id,{confirmation:'Island'},{});assert.equal((await f.service.runSchedule('w',task.id)).status,'skipped');await f.engine.tick();await f.db.prepare("UPDATE servers SET status='offline' WHERE id=?").run(f.server.id);const ws=await f.db.prepare("SELECT * FROM workspaces WHERE id='w'").get();let alerts=0;await observeHealth(f.db,ws,await f.service.getServer('w',f.server.id),async()=>{alerts++;});assert.equal((await f.db.prepare('SELECT count(*) AS n FROM incidents').get()).n,0);assert.equal(alerts,0);await f.engine.cancel('w',run_id);await f.engine.tick();await observeHealth(f.db,ws,await f.service.getServer('w',f.server.id),async()=>{alerts++;});assert.equal(alerts,1);
});
test('a busy command guard defers an unsent workflow action and sends it only once after the probe finishes',async t=>{
  const f=await fixture(t),gate=f.holdStatus(),probe=f.service.action('w',f.server.id,'status');await gate.started;try{const flow=await f.save({steps:[{type:'broadcast',message:'Hello {server}'}]}),{run_id}=await f.engine.start('w',flow.id,{},{});await f.engine.tick();assert.equal((await f.state(run_id)).status,'waiting');assert.equal(f.calls.filter(call=>call.action==='broadcast').length,0);gate.release();await probe;f.advance(5000);await f.engine.tick();assert.equal((await f.state(run_id)).status,'succeeded');assert.equal(f.calls.filter(call=>call.action==='broadcast').length,1);}finally{gate.release();await probe.catch(()=>{});}
});
test('a failed external step stops later actions and is never automatically retried',async t=>{
  const f=await fixture(t);f.fail('save');const flow=await f.save({steps:[{type:'save'},{type:'restart'}],confirmation:'Island'}),{run_id}=await f.engine.start('w',flow.id,{},{}).catch(()=>f.engine.start('w',flow.id,{confirmation:'Island'},{}));await f.engine.tick();await f.engine.tick();assert.equal((await f.state(run_id)).status,'failed');assert.deepEqual(f.calls.map(c=>c.action),['save']);
});
test('recovery refuses to replay an ambiguous executing action after process interruption',async t=>{
  const f=await fixture(t),flow=await f.save(),{run_id}=await f.engine.start('w',flow.id,{},{});await f.db.prepare("UPDATE workflow_runs SET status='running',steps=? WHERE id=?").run(JSON.stringify([{type:'save',status:'executing'}]),run_id);await f.engine.recover();await f.engine.tick();const run=await f.state(run_id);assert.equal(run.status,'failed');assert.equal(run.steps[0].status,'uncertain');assert.match(run.steps[0].detail,/uncertain/);assert.equal(f.calls.length,0);
});
test('cancellation wakes long waits immediately and blocks connection/host changes during active runs',async t=>{
  const f=await fixture(t),flow=await f.save({steps:[{type:'wait',seconds:3600},{type:'restart'}],confirmation:'Island'}),{run_id}=await f.engine.start('w',flow.id,{confirmation:'Island'},{});await f.engine.tick();
  await assert.rejects(f.service.updateServer('w',f.server.id,{host:'8.8.4.4'}),/active workflow/);await assert.rejects(f.service.removeServer('w',f.server.id),/active workflow/);await assert.rejects(f.operations.hostingAction('w',f.server.id,{action:'restart',confirmation:'Island'}),/active workflow/);await assert.rejects(f.operations.disconnectHosting('w',f.server.id),/active workflow/);
  await f.engine.cancel('w',run_id,{name:'Owner'});await f.engine.tick();assert.equal((await f.state(run_id)).status,'cancelled');assert.equal(f.calls.length,0);await f.service.updateServer('w',f.server.id,{notes:'Ready'});
});
test('backup verification waits for the exact archive and stops on provider failure',async t=>{
  const f=await fixture(t),flow=await f.save({steps:[{type:'backup'},{type:'wait_backup',timeout_minutes:5},{type:'notify',message:'Archive ready on {server}'}]}),{run_id}=await f.engine.start('w',flow.id,{},{});await f.engine.tick();await f.engine.tick();assert.equal((await f.state(run_id)).status,'waiting');assert.equal((await f.state(run_id)).steps[0].backup_id,f.backupId);f.setBackupStatus('completed');f.advance(30000);await f.engine.tick();await f.engine.tick();assert.equal((await f.state(run_id)).status,'succeeded');assert.ok(f.calls.some(c=>c.action==='discord-notify'));
  const another=await f.save({name:'Second archive',steps:[{type:'backup'},{type:'wait_backup',timeout_minutes:5},{type:'restart'}],confirmation:'Island'}),second=await f.engine.start('w',another.id,{confirmation:'Island'},{});f.setBackupStatus('failed');await f.engine.tick();await f.engine.tick();assert.equal((await f.state(second.run_id)).status,'failed');assert.ok(!f.calls.some(c=>c.action==='restart'));
});
test('read-only recovery probes retry within a deadline and time out before further actions',async t=>{
  const f=await fixture(t);f.setOnline(false);const flow=await f.save({steps:[{type:'verify_online',timeout_minutes:1},{type:'save'}]}),{run_id}=await f.engine.start('w',flow.id,{},{});await f.engine.tick();assert.equal((await f.state(run_id)).status,'waiting');f.advance(30000);await f.engine.tick();f.advance(30000);await f.engine.tick();assert.equal((await f.state(run_id)).status,'failed');assert.deepEqual(f.calls.map(c=>c.action),['status','status','status']);
});
test('webhook keys are hashed, rotated, header-only and deduplicated independently of history retention',async t=>{
  const f=await fixture(t),flow=await f.save({trigger_type:'webhook'}),{secret}=await f.engine.rotateKey('w',flow.id);assert.equal((await f.db.prepare('SELECT webhook_hash FROM workflows WHERE id=?').get(flow.id)).webhook_hash,hash(secret));assert.ok(!JSON.stringify(await f.engine.view('w')).includes(secret));await assert.rejects(f.engine.webhook(flow.id,'Bearer wrong',{event_id:'one'}),/credentials invalid/);
  const first=await f.engine.webhook(flow.id,'Bearer '+secret,{event_id:'one'}),duplicate=await f.engine.webhook(flow.id,'Bearer '+secret,{event_id:'one'});assert.equal(first.run_id,duplicate.run_id);assert.equal(duplicate.duplicate,true);await f.engine.tick();await f.db.prepare('DELETE FROM workflow_runs WHERE id=?').run(first.run_id);assert.equal((await f.engine.webhook(flow.id,'Bearer '+secret,{event_id:'one'})).duplicate,true);
  await f.engine.rotateKey('w',flow.id);await assert.rejects(f.engine.webhook(flow.id,'Bearer '+secret,{event_id:'two'}),/credentials invalid/);assert.equal(f.calls.filter(c=>c.action==='save').length,1);
});
test('concurrent starts serialize, enforce one active run per server, and respect quotas and cooldowns',async t=>{
  const f=await fixture(t),flow=await f.save({steps:[{type:'wait',seconds:60}]});const attempts=await Promise.allSettled([f.engine.start('w',flow.id,{},{}),f.engine.start('w',flow.id,{},{})]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);const other=await f.save({name:'Other routine'});await assert.rejects(f.engine.start('w',other.id,{},{}),/active workflow/);
  const id=attempts.find(r=>r.status==='fulfilled').value.run_id;await f.engine.cancel('w',id);await f.engine.tick();await assert.rejects(f.engine.start('w',flow.id,{},{}),/cooling down/);
  await f.db.prepare("UPDATE workspaces SET subscription_status='free' WHERE id='w'").run();await assert.rejects(f.save({name:'Third routine'}),/allows 2 workflows/);
});
test('active long-running jobs remain visible and cancellable when terminal history exceeds the display limit',async t=>{
  const f=await fixture(t),flow=await f.save({steps:[{type:'wait',seconds:3600}]}),{run_id}=await f.engine.start('w',flow.id,{},{});await f.db.query("INSERT INTO workflow_runs(id,workspace_id,workflow_id,server_id,name,trigger_type,actor,status,steps,next_step_at,created_at,updated_at,finished_at) SELECT 'finished-'||n,'w',$1,$2,'Finished run','manual','Fixture','succeeded','[]',$3::bigint,$3::bigint+n,$3::bigint+n,$3::bigint+n FROM generate_series(1,201) n",[flow.id,f.server.id,f.now()]);const view=await f.engine.view('w');assert.ok(view.runs.some(run=>run.id===run_id));assert.equal(view.runs.filter(run=>run.status==='succeeded').length,200);await f.engine.cancel('w',run_id);await f.engine.tick();assert.equal((await f.engine.detail('w',run_id)).status,'cancelled');
});
test('scheduled workflows advance before execution, respect maintenance and never replay missed intervals',async t=>{
  const f=await fixture(t),flow=await f.save({trigger_type:'interval',interval_minutes:15});await f.db.prepare('UPDATE workflows SET next_run=1 WHERE id=?').run(flow.id);await Promise.all([f.engine.tick(),f.engine.tick()]);assert.equal(f.calls.filter(c=>c.action==='save').length,1);assert.equal((await f.db.prepare('SELECT next_run FROM workflows WHERE id=?').get(flow.id)).next_run,f.now()+900000);
  await f.db.prepare('UPDATE servers SET maintenance=1 WHERE id=?').run(f.server.id);f.advance(3600000);await f.engine.tick();assert.equal(f.calls.length,1);assert.equal((await f.db.prepare('SELECT next_run FROM workflows WHERE id=?').get(flow.id)).next_run,f.now()+900000);
});
test('outage/recovery triggers use trusted incident transitions, deduplicate, and suppress restart loops',async t=>{
  const f=await fixture(t),outage=await f.save({trigger_type:'outage',cooldown_minutes:60,steps:[{type:'notify',message:'Outage on {server}'}]});const incident=randomUUID();f.advance(1);await f.db.prepare('INSERT INTO incidents(id,workspace_id,server_id,opened_at) VALUES(?,?,?,?)').run(incident,'w',f.server.id,f.now());await f.engine.tick();await f.engine.tick();assert.equal((await f.engine.view('w')).runs.length,1);
  const recovery=await f.save({name:'Recovery notice',trigger_type:'recovery',steps:[{type:'notify',message:'Recovered {server}'}]});f.advance(1);await f.db.prepare('UPDATE incidents SET resolved_at=? WHERE id=?').run(f.now(),incident);await f.engine.tick();assert.equal((await f.engine.view('w')).runs.length,2);assert.ok((await f.engine.view('w')).runs.some(run=>run.workflow_id===recovery.id));
  const second=await f.save({name:'Another outage rule',trigger_type:'outage',cooldown_minutes:60,steps:[{type:'save'}]});f.advance(1);await f.db.prepare('INSERT INTO incidents(id,workspace_id,server_id,opened_at) VALUES(?,?,?,?)').run(randomUUID(),'w',f.server.id,f.now());await f.engine.tick();assert.ok(!(await f.engine.view('w')).runs.some(run=>run.workflow_id===second.id));assert.ok(outage.id);
});
test('pausing requests cancellation, active definitions stay immutable and run snapshots retain their steps',async t=>{
  const f=await fixture(t),flow=await f.save({steps:[{type:'wait',seconds:60},{type:'save'}]}),{run_id}=await f.engine.start('w',flow.id,{},{});await f.engine.tick();await assert.rejects(f.engine.save('w',flow.id,{name:'Changed',server_id:f.server.id,steps:[{type:'notify',message:'Changed'}]}),/active run/);await f.engine.toggle('w',flow.id,false);await f.engine.tick();assert.equal((await f.state(run_id)).status,'cancelled');await f.engine.remove('w',flow.id);assert.equal((await f.state(run_id)).steps[1].type,'save');assert.equal((await f.state(run_id)).workflow_id,null);
});
test('workflow HTTP routes enforce scope, role, CSRF and secret-bearing hooks without dashboard sessions',async t=>{
  const f=await fixture(t),flow=await f.save({trigger_type:'webhook'});
  for(const [user,role,scope]of [['viewer','viewer',null],['scoped','admin',JSON.stringify([randomUUID()])],['admin','admin',JSON.stringify([f.server.id])]]){await f.db.prepare('INSERT INTO users VALUES(?,?,NULL,?)').run(user,user,f.vault.encrypt('token'));await f.db.prepare("INSERT INTO workspace_members VALUES(?,'w',?,?,?,1)").run(randomUUID(),user,role,scope);await f.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(user),user,user+'-csrf',Date.now()+600000);}
  const app=createApp({db:f.db,vault:f.vault,service:f.service,operations:f.operations,workflows:f.engine,billing:{ready:false},env:{APP_URL:'http://localhost:3000'}}),http=app.listen(0,'127.0.0.1');await once(http,'listening');t.after(()=>{http.closeAllConnections();http.close();});const url='http://127.0.0.1:'+http.address().port;
  const request=(path,user='admin',body={})=>fetch(url+'/api'+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:'rookrift_session='+user,Origin:'http://localhost:3000','X-CSRF-Token':user+'-csrf'},body:JSON.stringify(body)});
  assert.equal((await request('/workflows/'+flow.id+'/run','viewer')).status,403);assert.equal((await request('/workflows/'+flow.id+'/run','scoped')).status,404);
  const key=await(await request('/workflows/'+flow.id+'/webhook-key')).json();assert.ok(key.secret);const hook=await fetch(url+'/api/hooks/workflows/'+flow.id,{method:'POST',headers:{Authorization:'Bearer '+key.secret,'Content-Type':'application/json'},body:JSON.stringify({event_id:'trusted-test'})});assert.equal(hook.status,202);assert.equal(hook.headers.get('cache-control'),'no-store');
  const csrf=await fetch(url+'/api/workflows/'+flow.id+'/toggle',{method:'POST',headers:{Cookie:'rookrift_session=admin','Content-Type':'application/json'},body:'{"enabled":false}'});assert.equal(csrf.status,403);
});
