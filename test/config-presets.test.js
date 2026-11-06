import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CONFIG_FILES,CONFIG_SETTINGS,CONFIG_PRESETS,configPresetDraft,parseConfigPatch,serializeConfigEntries,validateGuidedEntries,importConfigSettings,compareConfigText} from '../shared/config-templates.js';
import {openDatabase} from '../server/db.js';
import {migrateDatabase} from '../server/migrations.js';
import {createVault} from '../server/crypto.js';
import {createConfigLibrary} from '../server/config-library.js';

test('all game/file presets produce valid independent native-format patches',()=>{
 assert.equal(CONFIG_PRESETS.length,12);assert.equal(new Set(CONFIG_PRESETS.map(p=>p.id)).size,12);
 for(const game of Object.keys(CONFIG_FILES)){
  assert.ok(CONFIG_PRESETS.some(p=>p.games.includes(game)));
  for(const p of CONFIG_PRESETS.filter(p=>p.games.includes(game))){const draft=configPresetDraft(p.id,game),entries=parseConfigPatch(game,draft.filename,draft.body);assert.ok(entries.length);validateGuidedEntries(game,draft.filename,entries);assert.equal(serializeConfigEntries(game,draft.filename,entries),draft.body);draft.preset_info.note='Changed';assert.notEqual(configPresetDraft(p.id,game).preset_info.note,'Changed');}
 }
 for(const s of CONFIG_SETTINGS)validateGuidedEntries(s.games[0],s.filename,[{section:s.section,key:s.key,value:s.default}]);
 assert.throws(()=>configPresetDraft('ark-weekend','dayz'),/matching/);assert.throws(()=>parseConfigPatch('minecraft','Game.ini','[ServerSettings]\nXPMultiplier=2'),/supported configuration file/);
});
test('guided validation preserves custom INI settings and rejects invalid catalogue values and native secret keys',()=>{
 const entries=parseConfigPatch('asa','GameUserSettings.ini','[ServerSettings]\nServerPVE=true\nXPMultiplier=2\nCustomGameplay=unchanged');validateGuidedEntries('asa','GameUserSettings.ini',entries);assert.match(serializeConfigEntries('asa','GameUserSettings.ini',entries),/CustomGameplay=unchanged/);
 for(const [game,file,body]of [['minecraft','server.properties','rcon.password=private'],['minecraft','server.properties','view-distance=2'],['minecraft','server.properties','max-players=2.5'],['minecraft','server.properties','max-players=2.0'],['minecraft','server.properties','max-players=2e1'],['minecraft','server.properties','pvp=True'],['minecraft','server.properties','pvp=false\npvp=true'],['minecraft','server.properties','pvp=false\\\nrcon.password=private'],['dayz','serverDZ.cfg','serverTimeAcceleration=65;'],['dayz','serverDZ.cfg','password="private";'],['dayz','serverDZ.cfg','class Missions {};']])assert.throws(()=>parseConfigPatch(game,file,body));
 assert.throws(()=>validateGuidedEntries('asa','GameUserSettings.ini',[{section:'ServerSettings',key:'XPMultiplier',value:'0x20'}]),/Experience rate/);
});
test('full file imports retain only recognised non-secret settings and detect duplicates and wrong file selections',()=>{
 const raw='[ServerSettings]\r\nServerAdminPassword=DO-NOT-COPY\r\nRCONPort=27020\r\nXPMultiplier=3\r\nServerPVE=true\r\n[Other]\r\nXPMultiplier=99\r\nUnknown=other';const result=importConfigSettings(raw,'asa','GameUserSettings.ini');assert.equal(result.entries.length,2);assert.equal(result.skipped,4);assert.match(result.body,/ServerPVE=True/);assert.ok(!JSON.stringify(result).includes('DO-NOT-COPY'));assert.ok(!result.body.includes('99'));
 assert.throws(()=>importConfigSettings('[ServerSettings]\nXPMultiplier=1\nxpmultiplier=2','ase','GameUserSettings.ini'),/repeats/);
 assert.throws(()=>importConfigSettings(raw,'asa','Game.ini'),/No recognised/);
 const mc=importConfigSettings('# generated\nrcon.password=DO-NOT-COPY\nonline-mode=true\npvp=false\nview-distance=8\nmanagement-server-secret=DO-NOT-COPY','minecraft','server.properties');assert.equal(mc.entries.length,2);assert.ok(!JSON.stringify(mc).includes('DO-NOT-COPY'));assert.ok(!mc.body.includes('online-mode'));
 assert.throws(()=>importConfigSettings('x'.repeat(262145),'dayz','serverDZ.cfg'),/size limit/);
});
test('DayZ imports skip nested classes, quoted comment markers and block comments without copying credentials',()=>{
 const raw='hostname="A // { server }";\npassword="DO-NOT-COPY";\n/* serverTimeAcceleration=63; */\nserverTimeAcceleration=6; // clock\nclass Missions\n{\n class DayZ {\n  serverTimeAcceleration=64;\n };\n};\nserverNightTimeAcceleration=2;\n';const result=importConfigSettings(raw,'dayz','serverDZ.cfg');assert.deepEqual(result.entries.map(e=>[e.key,e.value]),[['serverTimeAcceleration','6'],['serverNightTimeAcceleration','2']]);assert.ok(!JSON.stringify(result).includes('DO-NOT-COPY'));assert.ok(!result.body.includes('Missions'));assert.throws(()=>importConfigSettings('/* missing end','dayz','serverDZ.cfg'),/Close/);assert.throws(()=>importConfigSettings('class X {\nserverTimeAcceleration=1;','dayz','serverDZ.cfg'),/unbalanced/);
});
test('local comparisons expose targeted changes without returning full source or secrets',()=>{
 const source='[ServerSettings]\nServerAdminPassword=DO-NOT-RETURN\nXPMultiplier=1\nOther=unchanged';const changes=compareConfigText(source,'asa','GameUserSettings.ini','[ServerSettings]\nXPMultiplier=2');assert.deepEqual(changes,[{section:'ServerSettings',key:'XPMultiplier',before:'1',after:'2'}]);assert.ok(!JSON.stringify(changes).includes('DO-NOT-RETURN'));
 assert.deepEqual(compareConfigText('rcon.password=DO-NOT-RETURN\npvp=true\nview-distance=8','minecraft','server.properties','pvp=false\nview-distance=8\nwhite-list=true'),[{section:'',key:'pvp',before:'true',after:'false'},{section:'',key:'white-list',before:null,after:'true'}]);
 assert.deepEqual(compareConfigText('serverTimeAcceleration=6;','dayz','serverDZ.cfg','serverTimeAcceleration = 6;'),[]);
 assert.throws(()=>compareConfigText('[ServerSettings]\nXPMultiplier=1\nXPMultiplier=3','asa','GameUserSettings.ini','[ServerSettings]\nXPMultiplier=2'),/repeated/);
});
async function fixture(t){const db=await openDatabase(':memory:'),vault=createVault('b'.repeat(64));t.after(()=>db.close());await db.prepare("INSERT INTO users(id,name,access_token) VALUES('u','Owner','')").run();await db.prepare("INSERT INTO workspaces(id,owner_id,name,plan,subscription_status,created_at) VALUES('w','u','Test','cluster','active',1)").run();let hostCalls=0;const library=createConfigLibrary(db,vault,{getServer:async()=>{hostCalls++;throw new Error('Must not resolve a native export target');}},{withConfigHost:async()=>{hostCalls++;throw new Error('Must not contact a host');}});return{db,library,actor:{id:'u',name:'Owner'},hostCalls:()=>hostCalls};}
test('native exports and ARK presets save immutable revisions using the shared plan allowance',async t=>{
 const f=await fixture(t);for(const p of CONFIG_PRESETS)for(const game of p.games){const {preset_info,...draft}=configPresetDraft(p.id,game),saved=await f.library.save('w',null,draft,f.actor);assert.equal(saved.body,p.body);assert.equal(saved.game,game);if(game==='minecraft'){const body=saved.body;await f.library.save('w',saved.id,{...draft,summary:'Second revision'},f.actor);const versions=await f.library.versions('w',saved.id);assert.equal(versions.length,2);assert.equal(versions[1].body,body);}}
 assert.equal(f.hostCalls(),0);await f.db.prepare("UPDATE workspaces SET plan='scout',subscription_status='none' WHERE id='w'").run();const {preset_info,...draft}=configPresetDraft('dayz-bases','dayz');await assert.rejects(f.library.save('w',null,draft,f.actor),/allowance|limit|plan|upgrade/i);
});
test('manual export API paths cannot contact a host and reject cross-format or credential payloads',async t=>{
 const f=await fixture(t);for(const [id,game]of [['minecraft-survival','minecraft'],['dayz-daylight','dayz']]){const {preset_info,...draft}=configPresetDraft(id,game),saved=await f.library.save('w',null,draft,f.actor),target={server_id:randomUUID(),platform:'WindowsServer'};await assert.rejects(f.library.preview('w',saved.id,target),/manual configuration exports/);await assert.rejects(f.library.apply('w',saved.id,{...target,revision:1,preview_hash:'a'.repeat(64),confirmation:'Test'},f.actor),/manual configuration exports/);await assert.rejects(f.library.save('w',saved.id,{...draft,game:'asa',filename:'GameUserSettings.ini',body:'[ServerSettings]\nXPMultiplier=1'},f.actor),/separate template/);}
 await assert.rejects(f.library.save('w',null,{name:'Bad',game:'minecraft',filename:'Game.ini',body:'[X]\nY=2'},f.actor),/supported configuration file/);await assert.rejects(f.library.save('w',null,{name:'Bad',game:'minecraft',filename:'server.properties',body:'rcon.password=secret'},f.actor),/guided catalogue/);assert.equal(f.hostCalls(),0);
});
test('schema 26 upgrades existing ARK configuration records without altering revisions or accepting cross-game filenames',async t=>{
 const f=await fixture(t),id=randomUUID();await f.db.query('ALTER TABLE config_templates DROP CONSTRAINT config_templates_game_file_check');await f.db.query("ALTER TABLE config_templates ADD CONSTRAINT config_templates_game_check CHECK(game IN ('asa','ase')), ADD CONSTRAINT config_templates_filename_check CHECK(filename IN ('Game.ini','GameUserSettings.ini'))");await f.db.prepare('DELETE FROM schema_migrations WHERE version=26').run();await f.db.prepare("INSERT INTO config_templates VALUES(?,'w','Preserved','asa','Game.ini',1,1,1)").run(id);await f.db.prepare("INSERT INTO config_versions VALUES(?,?,1,'[/script/shootergame.shootergamemode]\nEggHatchSpeedMultiplier=2','Existing','Owner',1)").run(randomUUID(),id);await migrateDatabase(f.db);await migrateDatabase(f.db);assert.equal((await f.db.prepare('SELECT max(version) AS n FROM schema_migrations').get()).n,26);assert.equal((await f.library.versions('w',id))[0].summary,'Existing');await assert.rejects(f.db.prepare("INSERT INTO config_templates VALUES(?,'w','Invalid','dayz','Game.ini',1,1,1)").run(randomUUID()));
});
