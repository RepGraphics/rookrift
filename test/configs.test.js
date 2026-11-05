import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.js';
import {createVault,hash} from '../server/crypto.js';
import {createService} from '../server/service.js';
import {createOperations} from '../server/operations.js';
import {createConfigLibrary} from '../server/config-library.js';
import {createWorkflows} from '../server/workflows.js';
import {createHostingAdapter} from '../server/hosting.js';
import {createApp} from '../server/app.js';
import {parsePatch,previewPatch,configPath} from '../shared/config-ini.js';
const source='; Keep this comment\r\n[ServerSettings]\r\nServerAdminPassword=PRIVATE-ADMIN-PASSWORD\r\nXPMultiplier=1\r\nOtherSetting=unchanged\r\n\r\n[OtherSection]\r\nKeepMe=yes\r\n';
const templateInput={name:'Weekend rates',game:'asa',filename:'GameUserSettings.ini',body:'[ServerSettings]\nXPMultiplier=2\nHarvestAmountMultiplier=3\n',summary:'Weekend gameplay settings'};
async function fixture(t){
  const db=await openDatabase(':memory:'),vault=createVault(randomBytes(32).toString('hex'));t.after(()=>db.close());await db.prepare("INSERT INTO users VALUES('owner','Owner',NULL,?)").run(vault.encrypt('TOKEN'));await db.prepare("INSERT INTO workspaces(id,owner_id,plan,subscription_status,created_at) VALUES('w','owner','cluster','active',1)").run();
  const service=createService(db,vault,async()=>({output:'OK',players:[],latency:1})),server=await service.addServer('w',{name:'Island',game:'asa',map:'Island',host:'8.8.8.8',port:27020,password:'private-rcon'});await db.prepare('INSERT INTO hosting_connections VALUES(?,?,?,?,?,?,?)').run(server.id,'w','pterodactyl','https://panel.example.com','abcdefgh',vault.encrypt('private-panel-key'),1);
  let content=source,state='offline',uncertain=false,writeHook=null,writes=0;
  const hosting={resources:async()=>({state}),readFile:async()=>content,writeFile:async(connection,path,next)=>{writes++;if(writeHook)await writeHook();content=next;if(uncertain)throw Object.assign(new Error('Timeout after accepted write.'),{status:502});},action:async(c,action)=>{state=action==='stop'?'offline':'running';return{accepted:true};},backups:async()=>[]};
  const operations=createOperations(db,vault,service,hosting),configs=createConfigLibrary(db,vault,service,operations),actor={id:'owner',name:'Owner'},tpl=await configs.save('w',null,templateInput,actor),target={server_id:server.id,platform:'WindowsServer'};
  const apply=async overrides=>{const preview=await configs.preview('w',tpl.id,target);return configs.apply('w',tpl.id,{...target,revision:preview.revision,preview_hash:preview.preview_hash,confirmation:server.name,...overrides},actor);};
  return{db,vault,service,server,hosting,operations,configs,actor,tpl,target,apply,getContent:()=>content,setContent:value=>{content=value;},setState:value=>{state=value;},uncertain:value=>{uncertain=value;},onWrite:value=>{writeHook=value;},writes:()=>writes};
}
test('INI patches preserve unrelated settings/comments/newlines and reject secrets, duplicate keys and array operations',()=>{
  const result=previewPatch(source,templateInput.body);assert.match(result.content,/ServerAdminPassword=PRIVATE-ADMIN-PASSWORD/);assert.match(result.content,/OtherSetting=unchanged/);assert.match(result.content,/KeepMe=yes/);assert.ok(result.content.includes('\r\n'));assert.equal(result.changes.length,2);assert.ok(!JSON.stringify(result.changes).includes('PRIVATE-ADMIN-PASSWORD'));
  for(const body of ['[ServerSettings]\nServerAdminPassword=secret','[ServerSettings]\nRCONPort=27020','[Section]\nApiKey=secret','[Section]\nAPI_KEY=secret','[Section]\nLicenceKey=secret','[Section]\n+Array=value','[Section]\nRate=1\nrate=2','Rate=2'])assert.throws(()=>parsePatch(body));
  assert.throws(()=>previewPatch('[Section]\nRate=1\nRate=2','[Section]\nRate=3'),/repeated/);
  const multi=previewPatch('[A]\nOld=1\n[B]\nOld=2\n','[A]\nNew=one\n[B]\nNew=two\n[C]\nNew=three');assert.match(multi.content,/\[A\][\s\S]*New=one[\s\S]*\[B\][\s\S]*New=two[\s\S]*\[C\][\s\S]*New=three/);
});
test('configuration versions remain immutable, keep the latest twenty and reject game/file changes',async t=>{
  const f=await fixture(t);for(let revision=2;revision<=22;revision++)await f.configs.save('w',f.tpl.id,{...templateInput,body:'[ServerSettings]\nXPMultiplier='+revision},f.actor);const versions=await f.configs.versions('w',f.tpl.id);assert.equal(versions.length,20);assert.equal(versions[0].revision,22);assert.equal(versions.at(-1).revision,3);await assert.rejects(f.configs.save('w',f.tpl.id,{...templateInput,game:'ase'},f.actor),/separate template/);
});
test('preview exposes only changed keys and apply encrypts the original before writing and verifies the result',async t=>{
  const f=await fixture(t),preview=await f.configs.preview('w',f.tpl.id,f.target);assert.equal(preview.provider_state,'offline');assert.equal(preview.path,configPath('WindowsServer','GameUserSettings.ini'));assert.ok(!JSON.stringify(preview).includes('PRIVATE-ADMIN-PASSWORD'));
  f.onWrite(async()=>{const row=await f.db.prepare("SELECT * FROM config_applications WHERE status='applying'").get();assert.ok(row);assert.equal(f.vault.decrypt(row.before_cipher),source);assert.ok(!row.before_cipher.includes('PRIVATE-ADMIN-PASSWORD'));await assert.rejects(f.service.updateServer('w',f.server.id,{notes:'Cannot change mid-write'}),/configuration operation/);});
  const applied=await f.apply();assert.equal(applied.status,'applied');assert.match(f.getContent(),/XPMultiplier=2/);assert.match(f.getContent(),/PRIVATE-ADMIN-PASSWORD/);const view=await f.configs.view('w');assert.ok(!JSON.stringify(view).includes('PRIVATE-ADMIN-PASSWORD'));assert.equal(view.applications[0].before_cipher,undefined);
});
test('apply requires stopped state, exact confirmation and a fresh file/template preview',async t=>{
  const f=await fixture(t);f.setState('running');await assert.rejects(f.apply(),/Stop this server/);f.setState('offline');await assert.rejects(f.apply({confirmation:'Wrong'}),/exact server name/);
  const old=await f.configs.preview('w',f.tpl.id,f.target);f.setContent(source+'; outside edit\r\n');await assert.rejects(f.configs.apply('w',f.tpl.id,{...f.target,preview_hash:old.preview_hash,revision:old.revision,confirmation:'Island'},f.actor),/fresh preview/);
  f.setContent(source);await f.configs.save('w',f.tpl.id,{...templateInput,body:'[ServerSettings]\nXPMultiplier=4'},f.actor);await assert.rejects(f.configs.apply('w',f.tpl.id,{...f.target,preview_hash:old.preview_hash,revision:old.revision,confirmation:'Island'},f.actor),/fresh preview/);assert.equal(f.writes(),0);
});
test('uncertain writes retain snapshots, block new workflows and can be reconciled without replaying a write',async t=>{
  const f=await fixture(t);f.uncertain(true);await assert.rejects(f.apply(),/outcome uncertain/);const record=(await f.configs.view('w')).applications[0];assert.equal(record.status,'uncertain');assert.equal(f.writes(),1);const engine=createWorkflows(f.db,f.service,f.operations),flow=await engine.save('w',null,{name:'Do not start during uncertainty',server_id:f.server.id,steps:[{type:'save'}]},f.actor);await assert.rejects(engine.start('w',flow.id,{},f.actor),/configuration operation/);
  await assert.rejects(f.operations.hostingAction('w',f.server.id,{action:'start',confirmation:'Island'}),/configuration operation/);await f.operations.hostingAction('w',f.server.id,{action:'stop',confirmation:'Island'});assert.equal((await f.configs.verify('w',record.id)).status,'applied');assert.equal(f.writes(),1);await engine.start('w',flow.id,{},f.actor);
});
test('rollback restores the encrypted original but refuses newer edits, a different target and a running server',async t=>{
  const f=await fixture(t),record=await f.apply(),applied=f.getContent();f.setState('running');await assert.rejects(f.configs.rollback('w',record.id,{confirmation:'Island'},f.actor),/Stop this server/);f.setState('offline');f.setContent(applied+'; edited after apply');await assert.rejects(f.configs.rollback('w',record.id,{confirmation:'Island'},f.actor),/newer edits/);f.setContent(applied);
  await f.db.prepare("UPDATE hosting_connections SET remote_id='otherhost' WHERE server_id=?").run(f.server.id);await assert.rejects(f.configs.rollback('w',record.id,{confirmation:'Island'},f.actor),/target changed/);await f.db.prepare("UPDATE hosting_connections SET remote_id='abcdefgh' WHERE server_id=?").run(f.server.id);
  await f.configs.rollback('w',record.id,{confirmation:'Island'},f.actor);assert.equal(f.getContent(),source);assert.equal((await f.configs.view('w')).applications[0].status,'rolled_back');
});
test('interrupted configuration operations recover as uncertain and stored snapshots survive template removal',async t=>{
  const f=await fixture(t),record=await f.apply();await f.db.prepare("UPDATE config_applications SET status='applying' WHERE id=?").run(record.id);await f.configs.recover();assert.equal((await f.configs.view('w')).applications[0].status,'uncertain');await f.configs.verify('w',record.id);await f.configs.remove('w',f.tpl.id);const view=await f.configs.view('w');assert.equal(view.templates.length,0);assert.equal(view.applications[0].template_id,null);await f.configs.rollback('w',record.id,{confirmation:'Island'},f.actor);assert.equal(f.getContent(),source);await f.configs.removeApplication('w',record.id);assert.equal((await f.configs.view('w')).applications.length,0);assert.equal(f.getContent(),source);
});
test('configuration reads reject binary/oversized files, path traversal, cross-game targets and active workflows',async t=>{
  const f=await fixture(t);f.setContent('NUL\0DATA');await assert.rejects(f.configs.preview('w',f.tpl.id,f.target),/UTF-8/);f.setContent('x'.repeat(262145));await assert.rejects(f.configs.preview('w',f.tpl.id,f.target),/256 KiB/);f.setContent(source);await assert.rejects(f.configs.preview('w',f.tpl.id,{...f.target,platform:'../../'}));
  await f.db.prepare("UPDATE servers SET game='ase' WHERE id=?").run(f.server.id);await assert.rejects(f.configs.preview('w',f.tpl.id,f.target),/same ARK game/);await f.db.prepare("UPDATE servers SET game='asa' WHERE id=?").run(f.server.id);
  const engine=createWorkflows(f.db,f.service,f.operations),flow=await engine.save('w',null,{name:'Reserved server',server_id:f.server.id,steps:[{type:'wait',seconds:60}]},f.actor);await engine.start('w',flow.id,{},f.actor);await assert.rejects(f.configs.preview('w',f.tpl.id,f.target),/active workflow/);
});
test('Pterodactyl file adapter uses encoded fixed paths, raw text writes and exact backup references',async()=>{
  const calls=[],adapter=createHostingAdapter(async(...args)=>{calls.push(args);if(args[5]?.text)return '設定=値\n';return{attributes:{uuid:'11111111-1111-4111-8111-111111111111',completed_at:'2026-11-05',is_successful:true}};});const connection={origin:'https://panel.example.com',remote_id:'abcdefgh',key:'private-key'},path=configPath('WindowsServer','Game.ini');assert.equal(await adapter.readFile(connection,path),'設定=値\n');await adapter.writeFile(connection,path,'設定=値\n');assert.equal(calls[0][3],'GET');assert.ok(calls[0][1].endsWith(encodeURIComponent(path)));assert.equal(calls[1][3],'POST');assert.equal(calls[1][4],'設定=値\n');assert.equal(calls[1][5].raw,true);assert.equal((await adapter.backup(connection,'11111111-1111-4111-8111-111111111111')).status,'completed');await assert.rejects(adapter.backup(connection,'../bad'));
});
test('config HTTP permissions enforce global template editing, scoped deployment, CSRF and filtered history',async t=>{
  const f=await fixture(t);for(const [user,role,scope]of [['viewer','viewer',null],['admin','admin',[f.server.id]],['hidden','admin',[randomUUID()]]]){await f.db.prepare('INSERT INTO users VALUES(?,?,NULL,?)').run(user,user,f.vault.encrypt('token'));await f.db.prepare("INSERT INTO workspace_members VALUES(?,'w',?,?,?,1)").run(randomUUID(),user,role,scope===null?null:JSON.stringify(scope));await f.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(user),user,user+'-csrf',Date.now()+600000);}
  const app=createApp({db:f.db,vault:f.vault,service:f.service,operations:f.operations,configurations:f.configs,billing:{ready:false},env:{APP_URL:'http://localhost:3000'}}),http=app.listen(0,'127.0.0.1');await once(http,'listening');t.after(()=>{http.closeAllConnections();http.close();});const base='http://127.0.0.1:'+http.address().port;
  const req=(path,user='admin',body={},method='POST',csrf=true)=>fetch(base+'/api'+path,{method,headers:{Cookie:'rookrift_session='+user,'Content-Type':'application/json',...(csrf?{Origin:'http://localhost:3000','X-CSRF-Token':user+'-csrf'}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})});
  assert.equal((await req('/config-templates','admin',templateInput)).status,403);assert.equal((await req('/config-templates/'+f.tpl.id+'/preview','viewer',f.target)).status,403);assert.equal((await req('/config-templates/'+f.tpl.id+'/preview','hidden',f.target)).status,404);assert.equal((await req('/config-templates/'+f.tpl.id+'/preview','admin',f.target,'POST',false)).status,403);const preview=await req('/config-templates/'+f.tpl.id+'/preview','admin',f.target);assert.equal(preview.status,200);assert.ok(!(await preview.text()).includes('PRIVATE-ADMIN-PASSWORD'));
  await f.apply();const hidden=await(await req('/config-templates','hidden',{},'GET')).json();assert.equal(hidden.applications.length,0);
});
