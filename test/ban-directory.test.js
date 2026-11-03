import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,sep,basename} from 'node:path';
import {tmpdir as osTmpdir} from 'node:os';
import {openDatabase} from '../server/db.js';
import {createVault} from '../server/crypto.js';
import {createService} from '../server/service.js';
import {createOperations} from '../server/operations.js';
import {createBanDirectory} from '../server/ban-directory.js';
import {normalizeIdentity} from '../shared/ban-identity.js';
const eos='0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',uuid='9a5c2d10-7b43-4a80-a2f9-83a111222333';
const serverInput={name:'Private server name',game:'asa',map:'The Island',host:'8.8.8.8',port:27020,password:'never-share-password',cluster:'Northern Isles',max_players:70};
function fixture(t,transport){
  const db=openDatabase(':memory:'),vault=createVault(randomBytes(32).toString('hex')),calls=[];
  for(const n of [1,2,3]){db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(`u${n}`,`Secret staff ${n}`,null,'secret-token');db.prepare("INSERT INTO workspaces(id,owner_id,name,plan,subscription_status,created_at) VALUES(?,?,?,'cluster','active',?)").run(`w${n}`,`u${n}`,`Private workspace ${n}`,Date.now());}
  const service=createService(db,vault,async(server,vault,action,message)=>{calls.push({server:server.id,action,message});return transport?transport(action,message):action==='status'?{output:'OK',players:[`Private player name, ${eos.toUpperCase()}`,`Other private name, ${uuid.toUpperCase()}`],latency:10}:{output:'Command acknowledged.'};});
  const operations=createOperations(db,vault,service),directory=createBanDirectory(db);t.after(()=>db.close());
  async function ban(workspace='w2',options={}){const server=service.addServer(workspace,{...serverInput,...options});await service.action(workspace,server.id,'status');await operations.moderate(workspace,{server_id:server.id,identifier:eos,identity_kind:'eos',action:'ban',reason:'PRIVATE reason for staff only'},'Private moderator');return server;}
  return {db,service,operations,directory,calls,ban};
}
const search=(extra={})=>({identifier:eos,identity_kind:'eos',...extra});
test('ID normalization accepts UUID formats and EOS hex case while preserving separate namespaces',()=>{
  const canonical=normalizeIdentity(uuid);assert.equal(canonical.kind,'uuid');
  for(const value of [uuid.toUpperCase(),uuid.replaceAll('-',''),`{${uuid}}`,`urn:uuid:${uuid}`])assert.equal(normalizeIdentity(value,'uuid').key,canonical.key);
  assert.equal(normalizeIdentity(eos.toUpperCase()).key,normalizeIdentity(eos).key);
  assert.notEqual(normalizeIdentity(eos,'uuid').key,normalizeIdentity(eos,'eos').key);
  assert.notEqual(normalizeIdentity('Opaque-EOS','eos').key,normalizeIdentity('opaque-eos','eos').key);
  assert.equal(normalizeIdentity('76561198000000001').kind,'steam');
});
test('lookup IDs reject wildcards, command characters, invalid UUIDs and invalid namespaces',()=>{
  for(const value of ['','*','name with spaces','PLAYER|DoExit','a'.repeat(129)])assert.throws(()=>normalizeIdentity(value));
  assert.throws(()=>normalizeIdentity(eos,'person'));assert.throws(()=>normalizeIdentity('PLAYER-001','uuid'));assert.throws(()=>normalizeIdentity(eos,'steam'));
});
test('community sharing is off by default and exact lookup exposes only opted-in sources',async t=>{
  const {directory,ban,calls}=fixture(t);await ban();assert.equal(directory.preferences('w2').sharing_enabled,false);
  assert.equal(directory.lookup('w1',search()).community.total,0);assert.equal(directory.ownBans('w2').total,1);
  directory.updatePreferences('w2',{sharing_enabled:true,public_name:'Northwatch'});const count=calls.length,result=directory.lookup('w1',search({identifier:eos.toUpperCase()}));
  assert.equal(result.community.total,1);assert.equal(result.community.items[0].community,'Northwatch');assert.equal(result.own.total,0);assert.equal(calls.length,count);
  assert.equal(directory.lookup('w2',search()).community.total,0);assert.equal(directory.lookup('w2',search()).own.total,1);
});
test('results group server reports by cluster and game without treating games as one identity',async t=>{
  const {directory,ban}=fixture(t);await ban();await ban('w2',{name:'Second server'});await ban('w2',{name:'Other cluster',cluster:'South'});await ban('w2',{name:'Legacy',game:'ase'});
  directory.updatePreferences('w2',{sharing_enabled:true,public_name:'Northwatch'});const result=directory.lookup('w1',search());
  assert.equal(result.community.total,3);assert.equal(result.community.items.find(row=>row.cluster==='Northern Isles'&&row.game==='asa').active_servers,2);
  assert.equal(directory.lookup('w1',search({game:'ase'})).community.total,1);assert.equal(directory.ownBans('w2',{game:'asa'}).total,2);
});
test('shared serialization excludes reasons, player and staff names, addresses and private workspace IDs',async t=>{
  const {directory,ban}=fixture(t);await ban();directory.updatePreferences('w2',{sharing_enabled:true,public_name:'Public community'});
  const result=directory.lookup('w1',search()),serialized=JSON.stringify(result);
  for(const value of ['PRIVATE','Private player','Private moderator','8.8.8.8','Private server name','never-share-password','Private workspace','"w2"','workspace_id','server_id','player_name','reason','actor'])assert.equal(serialized.includes(value),false,value);
  assert.deepEqual(Object.keys(result.community.items[0]).sort(),['id','community','cluster','game','active','server_count','active_servers','first_reported_at','last_updated_at','withdrawn_at','evidence'].sort());
});
test('unclustered reports use a generic public label and deleted servers remove their reports',async t=>{
  const {directory,ban,db}=fixture(t);const server=await ban('w2',{cluster:''});directory.updatePreferences('w2',{sharing_enabled:true,public_name:'Northwatch'});
  const result=directory.lookup('w1',search());assert.equal(result.community.items[0].cluster,'Unclustered server');assert.equal(JSON.stringify(result).includes('Private server name'),false);assert.equal(directory.ownBans('w2').items[0].cluster,'Private server name');
  db.prepare('DELETE FROM servers WHERE id=?').run(server.id);assert.equal(directory.lookup('w1',search({include_withdrawn:true})).community.total,0);
});
test('unban withdraws reports after the last active server and re-ban restores the report',async t=>{
  const {directory,ban,operations,service}=fixture(t);const first=await ban(),second=await ban('w2',{name:'Second'});directory.updatePreferences('w2',{sharing_enabled:true,public_name:'Public community'});
  const unban=server=>operations.moderate('w2',{server_id:server.id,identifier:eos.toUpperCase(),identity_kind:'eos',action:'unban',reason:'Appeal accepted privately'},'Staff');
  await unban(first);assert.equal(directory.lookup('w1',search()).community.items[0].active_servers,1);
  await unban(second);assert.equal(directory.lookup('w1',search()).community.total,0);
  const withdrawn=directory.lookup('w1',search({include_withdrawn:true})).community.items[0];assert.equal(withdrawn.active,false);assert.ok(withdrawn.withdrawn_at);assert.equal(directory.ownBans('w2',{status:'withdrawn'}).total,1);
  await service.action('w2',first.id,'status');await operations.moderate('w2',{server_id:first.id,identifier:eos,action:'ban',reason:'New private reason'},'Staff');
  assert.equal(directory.lookup('w1',search()).community.items[0].active,true);assert.equal(directory.lookup('w1',search()).community.items[0].withdrawn_at,null);
});
test('opting out hides reports immediately and retains the private moderation history',async t=>{
  const {directory,ban,operations}=fixture(t);await ban();directory.updatePreferences('w2',{sharing_enabled:true,public_name:'Northwatch'});assert.equal(directory.lookup('w1',search()).community.total,1);
  directory.updatePreferences('w2',{sharing_enabled:false,public_name:'Northwatch'});assert.equal(directory.lookup('w1',search({include_withdrawn:true})).community.total,0);assert.equal(directory.ownBans('w2').total,1);assert.equal(operations.moderation('w2')[0].reason,'PRIVATE reason for staff only');
  directory.updatePreferences('w2',{sharing_enabled:true,public_name:'New public name'});assert.equal(directory.lookup('w1',search()).community.items[0].community,'New public name');
});
test('rejected game commands do not produce active shared reports',async t=>{
  const {service,operations,directory}=fixture(t,async action=>action==='status'?{output:'OK',players:[`Player, ${eos}`],latency:10}:{output:'Invalid player id'});const server=service.addServer('w2',serverInput);await service.action('w2',server.id,'status');directory.updatePreferences('w2',{sharing_enabled:true,public_name:'Northwatch'});
  await assert.rejects(operations.moderate('w2',{server_id:server.id,identifier:eos,action:'ban',reason:'Private reason'},'Staff'),/rejected/);assert.equal(directory.lookup('w1',search()).community.total,0);assert.equal(directory.ownBans('w2').total,0);
});
test('UUID case and dash variants cannot duplicate an active ban and RCON uses the original reported ID',async t=>{
  const {service,operations,calls}=fixture(t);const server=service.addServer('w2',serverInput);await service.action('w2',server.id,'status');
  const value={server_id:server.id,identifier:uuid.replaceAll('-',''),identity_kind:'uuid',action:'ban',reason:'Private reason'};
  await operations.moderate('w2',value,'Staff');assert.equal(calls.at(-1).message,uuid.toUpperCase());
  await assert.rejects(operations.moderate('w2',{...value,identifier:uuid},'Staff'),/already exists/);
  await operations.moderate('w2',{...value,action:'unban',identifier:uuid},'Staff');assert.equal(calls.at(-1).message,uuid.toUpperCase());
});
test('the same compact token can be explicitly tracked as UUID or EOS without conflation',async t=>{
  const {service,operations,directory}=fixture(t);const server=service.addServer('w2',serverInput);await service.action('w2',server.id,'status');const value={server_id:server.id,identifier:eos,action:'ban',reason:'Private reason'};
  await operations.moderate('w2',{...value,identity_kind:'uuid'},'Staff');directory.updatePreferences('w2',{sharing_enabled:true,public_name:'Northwatch'});assert.equal(directory.lookup('w1',search()).community.total,0);
  assert.equal(directory.lookup('w1',search({identity_kind:'uuid'})).community.total,1);
  await operations.moderate('w2',{...value,identity_kind:'eos'},'Staff');assert.equal(directory.ownBans('w2').total,2);
});
test('private directory paginates beyond the moderation history limit and isolates the owner',async t=>{
  const {service,db,directory}=fixture(t);const server=service.addServer('w2',serverInput);
  const insert=db.prepare("INSERT INTO moderation(id,workspace_id,server_id,identifier,player_name,action,reason,actor,active,created_at,identity_kind,identity_key) VALUES(?,'w2',?,?,'Private','ban','Private','Staff',1,?,'game',?)");
  for(let index=0;index<231;index++){const identifier=`PLAYER-${index}`;insert.run(randomUUID(),server.id,identifier,index,`game:${identifier}`);}
  const first=directory.ownBans('w2'),last=directory.ownBans('w2',{page:10});assert.equal(first.total,231);assert.equal(first.items.length,25);assert.equal(first.has_more,true);assert.equal(last.items.length,6);assert.equal(last.has_more,false);assert.equal(directory.ownBans('w1').total,0);
});
test('legacy migration backfills IDs, consolidates variants without deleting history, and defaults sharing off',t=>{
  const folder=mkdtempSync(join(osTmpdir(),'rookrift-ban-migration-')),file=join(folder,'legacy.sqlite');t.after(()=>{if(resolve(folder).startsWith(resolve(osTmpdir())+sep)&&basename(folder).startsWith('rookrift-ban-migration-'))rmSync(folder,{recursive:true,force:true});});let db=openDatabase(file);
  db.prepare("INSERT INTO users VALUES('u','Staff',NULL,'secret')").run();db.prepare("INSERT INTO workspaces(id,owner_id,created_at) VALUES('w','u',1)").run();db.prepare("INSERT INTO servers(id,workspace_id,name,game,map,host,port,password,created_at) VALUES('s','w','World','asa','Island','8.8.8.8',27020,'encrypted',1)").run();
  const insert=db.prepare("INSERT INTO moderation(id,workspace_id,server_id,identifier,player_name,action,reason,actor,active,created_at) VALUES(?,'w','s',?,'Private player','ban','Keep private','Staff',1,?)");insert.run('m1',eos,1);insert.run('m2',eos.toUpperCase(),2);
  db.exec('DROP INDEX idx_one_active_identity_ban; DROP INDEX idx_moderation_identity; DROP INDEX idx_moderation_server_identity; ALTER TABLE moderation DROP COLUMN identity_kind; ALTER TABLE moderation DROP COLUMN identity_key; ALTER TABLE workspaces DROP COLUMN ban_sharing_enabled; ALTER TABLE workspaces DROP COLUMN ban_public_name; DROP TABLE ban_directory_reports; PRAGMA user_version=2');db.close();db=openDatabase(file);
  assert.equal(db.prepare('SELECT count(*) AS n FROM moderation').get().n,2);assert.equal(db.prepare('SELECT sum(active) AS n FROM moderation').get().n,1);assert.equal(db.prepare("SELECT identity_key,reason FROM moderation WHERE id='m1'").get().identity_key,`eos:${eos}`);assert.equal(createBanDirectory(db).preferences('w').sharing_enabled,false);assert.equal(db.prepare("SELECT reason FROM moderation WHERE id='m1'").get().reason,'Keep private');db.close();db=openDatabase(file);assert.equal(createBanDirectory(db).ownBans('w').total,1);db.close();
});
