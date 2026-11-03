import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { openDatabase, publicServer, playerSnapshot, listServers } from '../server/db.js';
import { createVault } from '../server/crypto.js';
import { createService } from '../server/service.js';
import { csvCell, activityCsv } from '../shared/csv.js';
const input = { name: 'Island', game: 'asa', map: 'The Island', host: '8.8.8.8', port: 27020, password: 'initial-secret', max_players: 70, cluster: 'Main cluster' };
function fixture(t, transport = async () => ({ output: 'OK', players: ['Nora, DEMO-1'], latency: 5 })) {
  const db = openDatabase(':memory:'), vault = createVault(randomBytes(32).toString('hex'));
  for (const id of ['u1','u2']) db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id,id,null,'encrypted');
  db.prepare("INSERT INTO workspaces(id,owner_id,plan,subscription_status,created_at) VALUES('w1','u1','tribe','active',?)").run(Date.now());
  db.prepare("INSERT INTO workspaces(id,owner_id,created_at) VALUES('w2','u2',?)").run(Date.now());
  t.after(() => db.close()); return { db, vault, service: createService(db,vault,transport) };
}
test('server edits preserve blank passwords, encrypt replacements, reset connection snapshots, and isolate tenants', async t => {
  const { db, vault, service } = fixture(t); const server = service.addServer('w1',input);
  await service.action('w1',server.id,'status'); const old = service.getServer('w1',server.id).password;
  const changed = service.updateServer('w1',server.id,{ name:'Island renamed', cluster:'  PvE cluster  ', password:'' });
  assert.equal(changed.cluster,'PvE cluster'); assert.equal(changed.status,'online'); assert.equal(changed.password,undefined); assert.equal(changed.player_list,undefined);
  assert.equal(service.getServer('w1',server.id).password,old);
  service.updateServer('w1',server.id,{ password:'replacement-secret' });
  const stored = service.getServer('w1',server.id); assert.equal(vault.decrypt(stored.password),'replacement-secret'); assert.equal(stored.status,'unknown'); assert.equal(stored.player_list,'[]'); assert.equal(stored.players,0);
  assert.throws(() => service.updateServer('w2',server.id,{ name:'Foreign' }),/not found/);
  assert.throws(() => service.updateServer('w1',server.id,{ workspace_id:'w2' }));
  assert.equal(JSON.stringify(publicServer(stored)).includes('replacement-secret'),false);
});
test('bulk actions validate every target and entitlement before any server receives a command', async t => {
  let calls=0; const { db,service }=fixture(t,async()=>{ calls++;return {output:'OK'}; });
  const first=service.addServer('w1',input), second=service.addServer('w1',{...input,name:'Scorched'}), foreign=service.addServer('w2',input);
  await assert.rejects(service.bulkAction('w1',{server_ids:[first.id,foreign.id],action:'save'}),/not found/); assert.equal(calls,0);
  db.prepare("UPDATE workspaces SET subscription_status='canceled' WHERE id='w1'").run();
  await assert.rejects(service.bulkAction('w1',{server_ids:[first.id,second.id],action:'save'}),/paused/); assert.equal(calls,0);
});
test('bulk actions report partial failures, validate broadcasts, and reject duplicate targets', async t => {
  let calls=0; const {service}=fixture(t,async server=>{calls++; if(server.name==='Broken')throw new Error('secret failure'); return {output:'Saved'};});
  const good=service.addServer('w1',input), bad=service.addServer('w1',{...input,name:'Broken'});
  await assert.rejects(service.bulkAction('w1',{server_ids:[good.id,good.id],action:'save'}));
  await assert.rejects(service.bulkAction('w1',{server_ids:[good.id],action:'broadcast',message:' '}),/Broadcast/); assert.equal(calls,0);
  const result=await service.bulkAction('w1',{server_ids:[good.id,bad.id],action:'save'});
  assert.deepEqual(result.results.map(row=>row.ok),[true,false]); assert.equal(calls,2);
  assert.equal(result.results[1].detail.includes('secret failure'),false); assert.equal(service.getServer('w1',bad.id).status,'offline');
});
test('maintenance skips automations while monitoring and manual controls remain available', async t => {
  const calls=[]; const { db,service }=fixture(t,async(server,vault,action)=>{calls.push(action);return {output:'OK',...(action==='status'?{players:['Nora, 123'],latency:2}:{})};});
  const server=service.addServer('w1',input), task=service.addSchedule('w1',{server_id:server.id,name:'Hourly save',action:'save',interval_minutes:60});
  service.updateServer('w1',server.id,{maintenance:true}); db.prepare('UPDATE schedules SET next_run=0 WHERE id=?').run(task.id);
  await service.runDueSchedules(); assert.equal(calls.length,0); assert.equal(service.getSchedule('w1',task.id).last_status,'skipped');
  assert.ok(service.getSchedule('w1',task.id).next_run>Date.now());
  await service.pollAll(); await service.action('w1',server.id,'save'); assert.deepEqual(calls,['status','save']);
  service.updateServer('w1',server.id,{maintenance:false}); const next=service.getSchedule('w1',task.id).next_run;
  await service.runSchedule('w1',task.id); assert.equal(service.getSchedule('w1',task.id).next_run,next); assert.equal(service.getSchedule('w1',task.id).last_status,'success');
});
test('connection alerts honor workspace preferences and per-server maintenance without hiding audit events', async t => {
  let online=true; const notices=[]; const {db,service}=fixture(t,async()=>{if(!online)throw new Error('Offline');return {output:'OK',players:[],latency:1};});
  const server=service.addServer('w1',input); await service.pollAll();
  db.prepare("UPDATE workspaces SET alerts_enabled=0 WHERE id='w1'").run(); online=false; await service.pollAll(async(_,text)=>notices.push(text)); assert.equal(notices.length,0);
  db.prepare("UPDATE workspaces SET alerts_enabled=1 WHERE id='w1'").run(); online=true; await service.pollAll(async(_,text)=>notices.push(text)); assert.equal(notices.length,1);
  service.updateServer('w1',server.id,{maintenance:true}); online=false; await service.pollAll(async(_,text)=>notices.push(text)); assert.equal(notices.length,1);
  assert.ok(db.prepare("SELECT count(*) AS n FROM activity WHERE title='Server went offline'").get().n>=2);
});
test('automation edits validate ownership, reset the next run, and enforce paid limits on run and enable', async t => {
  const {db,service}=fixture(t); const server=service.addServer('w1',input), foreign=service.addServer('w2',input);
  const task=service.addSchedule('w1',{server_id:server.id,name:'Old task',action:'save',interval_minutes:15});
  assert.throws(()=>service.updateSchedule('w1',task.id,{server_id:foreign.id,name:'Hijack',action:'save',interval_minutes:30}),/not found/);
  assert.throws(()=>service.updateSchedule('w1',task.id,null));
  service.updateSchedule('w1',task.id,{server_id:server.id,name:'New task',action:'broadcast',message:'Welcome',interval_minutes:120});
  const updated=service.getSchedule('w1',task.id); assert.equal(updated.name,'New task'); assert.ok(updated.next_run>Date.now()+119*60000);
  db.prepare("UPDATE workspaces SET subscription_status='canceled' WHERE id='w1'").run();
  await assert.rejects(service.runSchedule('w1',task.id),/paused by your current plan/);
  assert.throws(()=>service.updateSchedule('w1',task.id,{enabled:true}),/paused by your current plan/);
  assert.doesNotThrow(()=>service.updateSchedule('w1',task.id,{enabled:false}));
});
test('failed and successful run-now executions retain outcomes and do not move the next interval', async t => {
  let fail=true; const {service}=fixture(t,async()=>{if(fail)throw new Error('network password=secret');return {output:'OK'};});
  const server=service.addServer('w1',input), task=service.addSchedule('w1',{server_id:server.id,name:'Save test',action:'save',interval_minutes:60});
  await assert.rejects(service.runSchedule('w1',task.id),/RCON connection failed/);
  const failed=service.getSchedule('w1',task.id); assert.equal(failed.last_status,'failed'); assert.equal(failed.last_detail.includes('password='),false); assert.equal(failed.next_run,task.next_run);
  fail=false; await service.runSchedule('w1',task.id); const success=service.getSchedule('w1',task.id);
  assert.equal(success.last_status,'success'); assert.ok(success.last_run); assert.equal(success.next_run,task.next_run);
});
test('player snapshots include only online entitled servers and never expose stored password fields', async t => {
  const {service,db}=fixture(t); const a=service.addServer('w1',input), b=service.addServer('w1',{...input,name:'Second'});
  await service.action('w1',a.id,'status'); await service.action('w1',b.id,'status');
  const servers=listServers(db,'w1').map((server,index)=>({...server,paused:index>0}));
  const players=playerSnapshot(servers); assert.equal(players.length,1); assert.equal(players[0].name,'Nora'); assert.equal(players[0].identifier,'DEMO-1'); assert.equal(players[0].cluster,'Main cluster'); assert.equal(players[0].password,undefined);
  servers[0].status='offline'; assert.deepEqual(playerSnapshot(servers),[]);
});
test('existing databases migrate idempotently without losing servers or encrypted passwords', t => {
  const directory=mkdtempSync(join(tmpdir(),'rookrift-test-')), filename=join(directory,'legacy.sqlite');
  t.after(()=>{if(resolve(directory).startsWith(resolve(tmpdir())+sep)&&basename(directory).startsWith('rookrift-test-'))rmSync(directory,{recursive:true,force:true});});
  let db=openDatabase(filename); db.prepare("INSERT INTO users VALUES('u','Owner',NULL,'encrypted')").run(); db.prepare("INSERT INTO workspaces(id,owner_id,created_at) VALUES('w','u',1)").run();
  db.prepare("INSERT INTO servers(id,workspace_id,name,game,map,host,port,password,created_at) VALUES('s','w','Existing','asa','Island','8.8.8.8',27020,'encrypted-password',1)").run();
  for(const [table,columns] of Object.entries({servers:['cluster','maintenance','player_list'],schedules:['last_run','last_status','last_detail'],workspaces:['alerts_enabled']}))for(const column of columns)db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  db.close(); db=openDatabase(filename); assert.equal(db.prepare("SELECT password FROM servers WHERE id='s'").get().password,'encrypted-password'); assert.equal(db.prepare('SELECT maintenance,cluster FROM servers').get().maintenance,0); db.close();
  db=openDatabase(filename); assert.equal(db.prepare('SELECT count(*) AS n FROM servers').get().n,1); assert.equal(db.prepare('PRAGMA user_version').get().user_version,1); db.close();
});
test('CSV exports escape cells, preserve commas and newlines, and neutralize spreadsheet formulas', () => {
  for(const value of ['=SUM(1,2)',' +1','@cmd','-10','\t=HYPERLINK("x")'])assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell('Hello "world"'),'"Hello ""world"""');
  const csv=activityCsv([{created_at:0,title:'=danger',detail:'Hello,\nworld',level:'info',server_id:'s'}],[{id:'s',name:'Island'}]);
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"\'=danger"')); assert.ok(csv.includes('"Hello,\nworld"')); assert.ok(csv.includes('"Island"'));
});
