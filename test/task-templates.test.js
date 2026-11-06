import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {TASK_TEMPLATES,taskTemplateAvailability,taskTemplateDraft} from '../shared/task-templates.js';
import {GAME_IDS,supportsAction} from '../shared/games.js';
import {scheduleSchema,createService} from '../server/service.js';
import {workflowSchema,createWorkflows} from '../server/workflows.js';
import {openDatabase} from '../server/db.js';
import {createVault} from '../server/crypto.js';
test('every game has editable scheduled and workflow templates that satisfy the actual API schemas',()=>{
 assert.equal(new Set(TASK_TEMPLATES.map(t=>t.id)).size,TASK_TEMPLATES.length);
 for(const game of GAME_IDS){
  const server={id:randomUUID(),game,name:'Test '+game},links=[{server_id:server.id,provider:'pterodactyl'}];
  for(const kind of ['schedule','workflow'])assert.ok(TASK_TEMPLATES.some(t=>t.kind===kind&&t.games.includes(game)));
  for(const template of TASK_TEMPLATES.filter(t=>t.games.includes(game))){
   const {draft}=taskTemplateDraft(template.id,server,{hostingLinks:links,timeZone:'Europe/London'});assert.equal(draft.enabled,false);assert.equal(draft.server_id,server.id);assert.equal(draft.time_zone,'Europe/London');assert.equal(taskTemplateAvailability(template,server,links),null);
   if(template.kind==='schedule'){scheduleSchema.parse(draft);if(draft.action!=='backup')assert.ok(supportsAction(game,draft.action));}else{workflowSchema.parse(draft);for(const step of draft.steps)if(['save','broadcast'].includes(step.type))assert.ok(supportsAction(game,step.type));assert.ok(!Object.hasOwn(draft,'confirmation'));}
  }
 }
});
test('host requirements distinguish Nitrado restarts from provider archives and DayZ never inherits a save step',()=>{
 const dayz={id:randomUUID(),name:'DayZ',game:'dayz'},archive=TASK_TEMPLATES.find(t=>t.id==='dayz-archive'),restart=TASK_TEMPLATES.find(t=>t.id==='dayz-restart');
 assert.match(taskTemplateAvailability(archive,dayz,[]),/supports backups/);assert.match(taskTemplateAvailability(archive,dayz,[{server_id:dayz.id,provider:'nitrado'}]),/supports backups/);assert.equal(taskTemplateAvailability(restart,dayz,[{server_id:dayz.id,provider:'nitrado'}]),null);
 assert.ok(!taskTemplateDraft('dayz-restart',dayz,{hostingLinks:[{server_id:dayz.id,provider:'nitrado'}]}).draft.steps.some(s=>s.type==='save'));
 assert.throws(()=>taskTemplateDraft('ark-save',dayz),/matching this template game/);assert.throws(()=>taskTemplateDraft('dayz-reminder',{...dayz,paused:true}),/paused/);assert.throws(()=>taskTemplateDraft('missing',dayz),/not found/);
});
test('template drafts are independent and invalid timezone input falls back to UTC',()=>{
 const server={id:randomUUID(),game:'asa'},options={hostingLinks:[{server_id:server.id,provider:'pelican'}],timeZone:'Not/AZone'},one=taskTemplateDraft('ark-restart',server,options);one.draft.steps[0].message='Changed';one.draft.days.length=0;
 const two=taskTemplateDraft('ark-restart',server,options);assert.equal(two.draft.time_zone,'UTC');assert.notEqual(two.draft.steps[0].message,'Changed');assert.equal(two.draft.days.length,7);assert.equal(two.draft.steps.filter(s=>s.type==='wait').reduce((n,s)=>n+s.seconds,0),300);
});
async function fixture(t){
 const db=await openDatabase(':memory:'),vault=createVault('a'.repeat(64));t.after(()=>db.close());await db.prepare("INSERT INTO users(id,name,access_token) VALUES('owner','Owner','')").run();await db.prepare("INSERT INTO workspaces(id,owner_id,name,plan,subscription_status,created_at) VALUES('w','owner','Tests','cluster','active',1)").run();const calls=[],service=createService(db,vault,async(server,key,action,message)=>{calls.push({game:server.game,action,message});return{output:'Acknowledged',latency:1};}),servers=[];
 for(const game of GAME_IDS)servers.push(await service.addServer('w',{name:'Test '+game,game,map:'World',host:'example.test',port:27020,password:'fixture',max_players:10}));return{db,vault,service,servers,calls};
}
test('template schedules save paused for every game and execute only after explicit enabling',async t=>{
 const f=await fixture(t);
 for(const server of f.servers){const {draft}=taskTemplateDraft('rules-reminder',server,{timeZone:'Europe/London'}),saved=await f.service.addSchedule('w',draft);assert.equal(saved.enabled,0);await f.db.prepare('UPDATE schedules SET next_run=? WHERE id=?').run(Date.now()-1000,saved.id);}
 await f.service.runDueSchedules();assert.equal(f.calls.length,0);
 const first=(await f.db.prepare('SELECT * FROM schedules ORDER BY sort_order LIMIT 1').get());await f.service.updateSchedule('w',first.id,{enabled:true});await f.db.prepare('UPDATE schedules SET next_run=? WHERE id=?').run(Date.now()-1000,first.id);await f.service.runDueSchedules();assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'broadcast');
});
test('full edits preserve a paused schedule when enabled is omitted and accept an explicit choice',async t=>{
 const f=await fixture(t),server=f.servers[0],{draft}=taskTemplateDraft('weekend-event',server),saved=await f.service.addSchedule('w',draft);const {enabled,...oldClientInput}=draft;
 const changed=await f.service.updateSchedule('w',saved.id,{...oldClientInput,name:'Edited event'});assert.equal(changed.enabled,0);assert.deepEqual(JSON.parse(changed.days),[5,6]);assert.equal((await f.service.updateSchedule('w',saved.id,{...oldClientInput,enabled:true})).enabled,1);assert.equal((await f.service.updateSchedule('w',saved.id,{...oldClientInput,enabled:false})).enabled,0);
 assert.equal((await f.service.addSchedule('w',{...oldClientInput,name:'Legacy custom task'})).enabled,1);assert.throws(()=>scheduleSchema.parse({...draft,enabled:'false'}));assert.equal(f.calls.length,0);
});
test('restart templates still require exact-name authorisation on the backend and saving never executes steps',async t=>{
 const f=await fixture(t),server=f.servers.find(s=>s.game==='dayz');await f.db.prepare('INSERT INTO hosting_connections VALUES(?,?,?,?,?,?,?)').run(server.id,'w','nitrado','https://api.nitrado.net','12345',f.vault.encrypt('fixture'),1);
 const engine=createWorkflows(f.db,f.service,{}),{draft}=taskTemplateDraft('dayz-restart',server,{hostingLinks:[{server_id:server.id,provider:'nitrado'}]});await assert.rejects(engine.save('w',null,draft,{name:'Owner'}),/Type the exact game server name/);const saved=await engine.save('w',null,{...draft,confirmation:server.name},{name:'Owner'});assert.equal(saved.enabled,false);assert.ok(!saved.steps.some(s=>s.type==='save'));await engine.tick();assert.equal(f.calls.length,0);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM workflow_runs').get()).n,0);
});
