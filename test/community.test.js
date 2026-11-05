import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {openDatabase} from '../server/db.js';
import {createVault,hash} from '../server/crypto.js';
import {createService} from '../server/service.js';
import {createApp} from '../server/app.js';
import {createCommunity} from '../server/community.js';
import {nextRun,scheduleLabel} from '../shared/scheduling.js';
import {migrateDatabase} from '../server/migrations.js';

async function fixture(t){
  const db=await openDatabase(':memory:'),vault=createVault(randomBytes(32).toString('hex'));
  for(const id of ['owner','applicant','other','moderator','scoped','viewer']){
    await db.prepare('INSERT INTO users VALUES(?,?,NULL,?)').run(id,id,vault.encrypt('private-discord-token'));
    await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(id),id,id+'-csrf',Date.now()+600000);
  }
  await db.prepare("INSERT INTO workspaces(id,owner_id,plan,subscription_status,created_at) VALUES('w','owner','cluster','active',1)").run();
  const service=createService(db,vault,async()=>({output:'OK',players:[],latency:1}));
  const server=await service.addServer('w',{name:'Public Island',game:'asa',map:'Island',host:'8.8.8.8',port:27020,password:'private-rcon-password'});
  await db.prepare("UPDATE servers SET status='online',players=12,last_checked=? WHERE id=?").run(Date.now(),server.id);
  for(const [id,role,scope]of [['moderator','moderator',null],['scoped','admin',JSON.stringify([server.id])],['viewer','viewer',null]])await db.prepare("INSERT INTO workspace_members VALUES(?,'w',?,?,?,1)").run(randomUUID(),id,role,scope);
  const community=createCommunity(db),site={slug:'public-outpost',title:'The Outpost',summary:'A place to play',rules:'Respect the rules.',discord_url:'https://discord.gg/outpost',enabled:true,applications_open:true,questions:['Why would you like to join?'],server_ids:[server.id]};
  await community.saveSite('w',site);
  const app=createApp({db,vault,service,billing:{ready:false},env:{APP_URL:'http://localhost:3000'}}),http=app.listen(0,'127.0.0.1');await once(http,'listening');
  t.after(async()=>{http.closeAllConnections();await new Promise(resolve=>http.close(resolve));try{await app.locals.flushAuditWrites();}finally{await db.close();}});
  const base='http://127.0.0.1:'+http.address().port;
  const request=async(path,method='GET',body,user='owner',verify=true)=>{const response=await fetch(base+'/api'+path,{method,headers:{...(user?{Cookie:'rookrift_session='+user}:{}),...(verify?{Origin:'http://localhost:3000','X-CSRF-Token':user+'-csrf'}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json(),headers:response.headers};};
  const application=async(user='applicant',kind='join')=>{const page=(await request('/public/communities/public-outpost','GET',null,user)).body;return request('/public/communities/public-outpost/applications','POST',{kind,game:'asa',identifier:'self-reported-EOS-ID',form_revision:page.site.form_revision,rules_accepted:true,answers:['I enjoy exploring.']},user);};
  return{db,service,community,site,server,request,application};
}
test('public pages opt in to selected server summaries and published news without leaking private fields',async t=>{
  const f=await fixture(t);await f.community.savePost('w',null,{title:'Public update',body:'Welcome',published:true});await f.community.savePost('w',null,{title:'Private draft',body:'DO NOT PUBLISH',published:false});
  const r=await f.request('/public/communities/public-outpost','GET',null,null);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.body.viewer,null);assert.equal(r.body.servers[0].players,12);assert.equal(r.body.posts.length,1);
  for(const secret of ['private-rcon-password','8.8.8.8','private-discord-token','DO NOT PUBLISH','workspace_id','access_token'])assert.ok(!JSON.stringify(r.body).includes(secret),secret);
  await f.community.saveSite('w',{...f.site,enabled:false});assert.equal((await f.request('/public/communities/public-outpost','GET',null,null)).status,404);
});
test('public status respects plan slots, selected servers, maintenance, and stale checks',async t=>{
  const f=await fixture(t);const second=await f.service.addServer('w',{name:'Hidden world',game:'asa',map:'Island',host:'8.8.4.4',port:27020,password:'secret'});assert.equal((await f.community.publicPage(f.site.slug)).servers.length,1);
  await f.db.prepare('UPDATE servers SET last_checked=? WHERE id=?').run(Date.now()-300000,f.server.id);assert.equal((await f.community.publicPage(f.site.slug)).servers[0].status,'unknown');
  await f.db.prepare('UPDATE servers SET maintenance=1 WHERE id=?').run(f.server.id);assert.equal((await f.community.publicPage(f.site.slug)).servers[0].status,'maintenance');
  await assert.rejects(f.community.saveSite('w',{...f.site,server_ids:[randomUUID()]}),/belonging/);
  assert.ok(second.id);
});
test('application forms require a session and CSRF, snapshot questions and prevent duplicate pending submissions',async t=>{
  const f=await fixture(t),path='/public/communities/public-outpost/applications';assert.equal((await f.request(path,'POST',{},null)).status,401);assert.equal((await f.request(path,'POST',{},'applicant',false)).status,403);
  const results=await Promise.all([f.application(),f.application()]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  const row=(await f.community.applications('w'))[0];assert.equal(JSON.parse(row.answers)[0].question,f.site.questions[0]);assert.equal(row.applicant,'applicant');
  assert.equal((await f.request('/public/communities/public-outpost','GET',null,'other')).body.applications.length,0);
  assert.equal((await f.request('/public/communities/public-outpost','GET',null,'applicant')).body.applications.length,1);
});
test('changed or closed forms reject stale submissions and unpublished hubs reject public writes',async t=>{
  const f=await fixture(t),old=(await f.community.publicPage(f.site.slug)).site.form_revision;
  await f.community.saveSite('w',{...f.site,questions:['A different question?']});
  const body={kind:'join',game:'asa',identifier:'EOS-ID',form_revision:old,rules_accepted:true,answers:['Old answer']};assert.equal((await f.request('/public/communities/public-outpost/applications','POST',body,'applicant')).status,409);
  await f.community.saveSite('w',{...f.site,applications_open:false});assert.equal((await f.application()).status,409);
  await f.community.saveSite('w',{...f.site,enabled:false});assert.equal((await f.request('/public/communities/public-outpost/applications','POST',body,'applicant')).status,404);
});
test('review access is restricted by role/scope and decisions are atomic, applicant-visible and audited',async t=>{
  const f=await fixture(t),submission=await f.application(),id=submission.body.id;
  for(const user of ['scoped','viewer'])assert.equal((await f.request('/community/applications','GET',null,user)).status,403);
  assert.equal((await f.request('/community','GET',null,'moderator')).status,403);
  const decisions=await Promise.all(['approved','declined'].map(status=>f.request('/community/applications/'+id,'PATCH',{status,decision_message:'Your decision is ready.'},'moderator')));assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);
  const applicant=(await f.request('/public/communities/public-outpost','GET',null,'applicant')).body.applications[0];assert.equal(applicant.decision_message,'Your decision is ready.');assert.equal(applicant.reviewed_by,undefined);
  assert.ok((await f.db.prepare("SELECT count(*) AS n FROM activity WHERE title LIKE 'Application %'").get()).n>=1);
  assert.equal((await f.request('/community/applications/'+id,'DELETE',null,'moderator')).status,403);
  assert.equal((await f.request('/community/applications/'+id,'DELETE')).status,200);
});
test('only the applicant can withdraw a pending form and staff cannot rewrite withdrawn decisions',async t=>{
  const f=await fixture(t),id=(await f.application()).body.id,path='/public/communities/public-outpost/applications/'+id;
  assert.equal((await f.request(path,'DELETE',null,'other')).status,404);assert.equal((await f.request(path,'DELETE',null,'applicant')).status,200);
  assert.equal((await f.request('/community/applications/'+id,'PATCH',{status:'approved',decision_message:'Welcome'})).status,409);
});
test('event RSVP capacity is atomic and duplicate requests reserve one place',async t=>{
  const f=await fixture(t),event=await f.community.saveEvent('w',null,{title:'Last place',body:'A shared adventure',starts_at:Date.now()+3600000,ends_at:Date.now()+7200000,capacity:1});
  const path='/public/communities/public-outpost/events/'+event.id+'/rsvp',results=await Promise.all(['applicant','other'].map(user=>f.request(path,'POST',{attending:true},user)));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winner=results[0].status===200?'applicant':'other';assert.equal((await f.request(path,'POST',{attending:true},winner)).status,200);assert.equal((await f.community.publicPage(f.site.slug)).events[0].attendees,1);
  assert.equal((await f.request(path,'POST',{attending:false},winner)).status,200);assert.equal((await f.request(path,'POST',{attending:true},winner==='other'?'applicant':'other')).status,200);
  const output=await f.community.publicPage(f.site.slug);assert.equal(output.events[0].user_id,undefined);assert.equal(output.events[0].attending,false);
});
test('cancelled events close RSVPs, capacity edits respect reservations, and records stay in their workspace',async t=>{
  const f=await fixture(t),input={title:'Community event',body:'Details',starts_at:Date.now()+3600000,ends_at:Date.now()+7200000,capacity:0};const event=await f.community.saveEvent('w',null,input);await f.community.rsvp(f.site.slug,{id:'applicant'},event.id,true);await f.community.rsvp(f.site.slug,{id:'other'},event.id,true);
  await assert.rejects(f.community.saveEvent('w',event.id,{...input,capacity:1}),/lower/);
  await f.community.saveEvent('w',event.id,{...input,cancelled:true});await assert.rejects(f.community.rsvp(f.site.slug,{id:'owner'},event.id,true),/closed/);
  await assert.rejects(f.community.saveEvent('foreign',event.id,input),/Workspace not found/);
  await assert.rejects(f.community.remove('w','events',randomUUID()),/not found/);
});
test('calendar schedules choose local weekdays and handle DST gaps and folds once per local day',()=>{
  const task={schedule_type:'weekly',days:[0,1,2,3,4,5,6],start_time:'01:30',time_zone:'Europe/London'};
  assert.equal(new Date(nextRun(task,Date.parse('2026-03-28T02:00:00Z'))).toISOString(),'2026-03-30T00:30:00.000Z');
  assert.equal(new Date(nextRun(task,Date.parse('2026-10-25T00:00:00Z'))).toISOString(),'2026-10-25T00:30:00.000Z');
  assert.equal(new Date(nextRun(task,Date.parse('2026-10-25T00:45:00Z'))).toISOString(),'2026-10-26T01:30:00.000Z');
  assert.equal(new Date(nextRun({...task,days:[1],start_time:'04:00'},Date.parse('2026-11-04T12:00:00Z'))).toISOString(),'2026-11-09T04:00:00.000Z');
  assert.match(scheduleLabel(task),/Daily.*01:30.*Europe\/London/);
});
test('portal-only members can open a dashboard later without creating workspaces during public browsing',async t=>{
  const f=await fixture(t);await f.request('/public/communities/public-outpost','GET',null,'applicant');assert.equal((await f.db.prepare("SELECT count(*) AS n FROM workspaces WHERE owner_id='applicant'").get()).n,0);
  const responses=await Promise.all([f.request('/bootstrap','GET',null,'applicant'),f.request('/bootstrap','GET',null,'applicant')]);assert.ok(responses.every(response=>response.status===200));assert.equal((await f.db.prepare("SELECT count(*) AS n FROM workspaces WHERE owner_id='applicant'").get()).n,1);
});
test('removing a server cleans its public selection without publishing an address or deleting community content',async t=>{
  const f=await fixture(t);await f.service.removeServer('w',f.server.id);assert.deepEqual((await f.community.manage('w')).site.server_ids,[]);assert.equal((await f.community.publicPage(f.site.slug)).servers.length,0);
});
test('calendar tasks persist, claim only once and backups use hosting rather than RCON',async t=>{
  const f=await fixture(t);await f.db.prepare('INSERT INTO hosting_connections VALUES(?,?,?,?,?,?,?)').run(f.server.id,'w','pterodactyl','https://panel.example.com','abcdefgh','encrypted-fixture',1);let backups=0;f.service.setBackupHandler(async()=>{backups++;return{id:'backup-request'};});
  const task=await f.service.addSchedule('w',{name:'Daily archive',server_id:f.server.id,action:'backup',schedule_type:'weekly',start_time:'04:00',time_zone:'Europe/London',days:[1,3,5]});assert.equal(task.schedule_type,'weekly');assert.deepEqual(JSON.parse(task.days),[1,3,5]);
  await f.db.prepare('UPDATE schedules SET next_run=1 WHERE id=?').run(task.id);await Promise.all([f.service.runDueSchedules(),f.service.runDueSchedules()]);assert.equal(backups,1);
  const run=await f.db.prepare('SELECT * FROM schedule_runs WHERE schedule_id=?').get(task.id);assert.equal(run.status,'success');assert.match(run.detail,/accepted by provider/);
  const changed=await f.service.updateSchedule('w',task.id,{enabled:false});assert.equal(changed.enabled,0);await f.db.prepare('DELETE FROM hosting_connections WHERE server_id=?').run(f.server.id);await assert.rejects(f.service.addSchedule('w',{server_id:f.server.id,name:'No provider',action:'backup',interval_minutes:60}),/Connect a hosting/);
  await assert.rejects(f.service.addSchedule('w',{server_id:f.server.id,name:'Bad timezone',action:'save',schedule_type:'weekly',days:[],time_zone:'Mars/Olympus'}));
});
test('PostgreSQL 0.6 upgrades preserve existing task order, next runs, ciphertext and records',async t=>{
  const db=await openDatabase(':memory:');t.after(()=>db.close());assert.match(db.schema,/^rookrift_test_[a-f0-9]{32}$/);
  // Recreate only this test's generated schema using the actual 0.6 migration.
  await db.exec(`DROP SCHEMA "${db.schema}" CASCADE; CREATE SCHEMA "${db.schema}"`);
  await db.exec(await readFile(new URL('../server/migrations/001-postgres.sql',import.meta.url),'utf8'));
  await db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at BIGINT NOT NULL); INSERT INTO schema_migrations VALUES(1,1)');
  await db.exec("INSERT INTO users VALUES('old-user','Owner',NULL,'encrypted-token'); INSERT INTO workspaces(id,owner_id,created_at) VALUES('old-workspace','old-user',1); INSERT INTO servers(id,workspace_id,name,game,map,host,port,password,created_at) VALUES('old-server','old-workspace','World','asa','Island','8.8.8.8',27020,'encrypted-password',1); INSERT INTO schedules(id,workspace_id,server_id,name,action,interval_minutes,next_run) VALUES('old-task','old-workspace','old-server','Hourly save','save',60,9876543210000)");
  await migrateDatabase(db);await migrateDatabase(db);
  const task=await db.prepare("SELECT * FROM schedules WHERE id='old-task'").get();assert.equal(task.next_run,9876543210000);assert.equal(task.schedule_type,'interval');assert.equal(task.sort_order,1);assert.equal((await db.prepare("SELECT password FROM servers WHERE id='old-server'").get()).password,'encrypted-password');  assert.equal((await db.prepare('SELECT count(*) AS n FROM schema_migrations').get()  ).n,18);
});
