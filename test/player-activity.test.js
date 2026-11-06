import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {openDatabase} from '../server/db.js';
import {createVault,hash} from '../server/crypto.js';
import {createService} from '../server/service.js';
import {createApp} from '../server/app.js';
import {observePlayers,createPlayerProfiles} from '../server/player-profiles.js';
import {createPlayerActivity,interruptPlayerSessions,recoverPlayerActivity,prunePlayerActivity} from '../server/player-activity.js';
const eos='a'.repeat(32),other='b'.repeat(32),DAY=86400000;
async function fixture(t){
 const db=await openDatabase(':memory:'),vault=createVault('a'.repeat(64));
 for(const id of ['owner','viewer']){await db.prepare('INSERT INTO users(id,name,access_token) VALUES(?,?,?)').run(id,id,'');await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(id),id,id+'-csrf',Date.now()+600000);}
 await db.prepare("INSERT INTO workspaces(id,owner_id,name,plan,subscription_status,created_at) VALUES('w','owner','Community','cluster','active',1),('other','viewer','Other','scout','free',1)").run();
 const state={fail:false},service=createService(db,vault,async()=>{if(state.fail)throw new Error('offline');return{players:['Alpha, '+eos],latency:1};}),activity=createPlayerActivity(db),servers=[];
 for(const [index,game]of ['asa','ase','minecraft','dayz'].entries()){const s=await service.addServer('w',{name:game+' World',game,map:'World',host:'example.test',port:27020,password:'fixture',max_players:10});await db.prepare("UPDATE servers SET created_at=?,status='online' WHERE id=?").run(index+1,s.id);servers.push({...s,workspace_id:'w'});}
 await db.prepare('INSERT INTO workspace_members VALUES(?,?,?,?,?,?)').run('member','w','viewer','viewer',JSON.stringify([servers[0].id]),1);await db.prepare('INSERT INTO session_workspaces VALUES(?,?)').run(hash('viewer'),'w');
 const app=createApp({db,vault,service,billing:{ready:false},env:{APP_URL:'http://localhost:3000'}}),http=app.listen(0,'127.0.0.1');await once(http,'listening');
 t.after(async()=>{http.closeAllConnections();await new Promise(r=>http.close(r));await app.locals.flushAuditWrites();await db.close();});
 const request=async(path,user='owner',method='GET')=>{const r=await fetch('http://127.0.0.1:'+http.address().port+'/api'+path,{method,headers:{Cookie:'rookrift_session='+user,Origin:'http://localhost:3000','X-CSRF-Token':user+'-csrf'}});return{status:r.status,body:await r.json()};};
 return{db,service,activity,servers,state,request,profiles:createPlayerProfiles(db),now:Date.now()-600000};
}
test('successful snapshots create bounded sessions; duplicates, late observations and repeated names do not inflate them',async t=>{
 const f=await fixture(t),s=f.servers[0],n=f.now;
 await observePlayers(f.db,s,['Alpha, '+eos,'Duplicate, '+eos],n);await observePlayers(f.db,s,['Renamed, '+eos],n+60000);await observePlayers(f.db,s,['Duplicate, '+eos],n+60000);await observePlayers(f.db,s,['Stale, '+eos],n+30000);
 let rows=await f.db.prepare('SELECT * FROM player_sessions').all();assert.equal(rows.length,1);assert.equal(rows[0].samples,2);assert.equal(rows[0].display_name,'Renamed');assert.equal(rows[0].start_reason,'baseline');
 await observePlayers(f.db,s,[],n+120000);rows=await f.db.prepare('SELECT * FROM player_sessions').all();assert.equal(rows[0].ended_at,n+60000);assert.equal(rows[0].end_detected_at,n+120000);assert.equal(rows[0].end_reason,'not_seen');
 await observePlayers(f.db,s,['Returned, '+eos],n+180000);const result=await f.activity.list('w',{},null,n+180001);assert.equal(result.total,2);assert.equal(result.summary.observed_ms,60000);assert.equal(result.summary.unique_players,1);assert.equal(result.summary.appearances,1);assert.equal(result.summary.disappearances,1);assert.equal(result.summary.current_players,1);assert.equal(result.leaders[0].sessions,2);assert.ok(result.events.some(e=>e.kind==='not_seen'));
});
test('gaps and connection failures end monitoring at the last sighting and recovery does not count downtime',async t=>{
 const f=await fixture(t),s=f.servers[0],n=f.now;await observePlayers(f.db,s,['Alpha, '+eos],n);await observePlayers(f.db,s,['Alpha, '+eos],n+60000);await interruptPlayerSessions(f.db,s,'connection_lost',n+120000);await observePlayers(f.db,s,['Alpha, '+eos],n+500000);await observePlayers(f.db,s,['Alpha, '+eos],n+800001);
 const rows=await f.db.prepare('SELECT * FROM player_sessions ORDER BY started_at').all();assert.equal(rows.length,3);assert.equal(rows[0].end_reason,'connection_lost');assert.equal(rows[0].ended_at,n+60000);assert.equal(rows[1].end_reason,'monitoring_gap');assert.equal(rows[1].ended_at,n+500000);assert.equal(rows[2].start_reason,'resumed');assert.equal((await f.activity.list('w',{},null,n+800002)).summary.observed_ms,60000);
});
test('runtime recovery and connection edits close sessions without claiming a normal disappearance',async t=>{
 const f=await fixture(t),s=f.servers[0],n=f.now;await observePlayers(f.db,s,['Alpha, '+eos],n);await recoverPlayerActivity(f.db,n+60000);assert.equal((await f.db.prepare('SELECT end_reason FROM player_sessions').get()).end_reason,'monitoring_restarted');await observePlayers(f.db,s,['Alpha, '+eos],n+120000);await f.service.updateServer('w',s.id,{host:'changed.example.test'});const rows=await f.db.prepare('SELECT * FROM player_sessions ORDER BY started_at').all();assert.equal(rows[1].end_reason,'connection_changed');assert.equal((await f.activity.list('w',{},null,n+180000)).summary.disappearances,0);
});
test('the real service records successful checks and closes sessions when its transport fails',async t=>{
 const f=await fixture(t);await f.service.action('w',f.servers[0].id,'status');f.state.fail=true;await assert.rejects(f.service.action('w',f.servers[0].id,'status'),/RCON connection failed/);assert.equal((await f.db.prepare('SELECT end_reason FROM player_sessions').get()).end_reason,'connection_lost');assert.equal((await f.db.prepare('SELECT online FROM player_observations').get()).online,0);
});
test('concurrent snapshots serialize and profiles keep native game identity namespaces separate',async t=>{
 const f=await fixture(t),n=f.now;
 await Promise.all(Array.from({length:5},()=>observePlayers(f.db,f.servers[0],['Same Name, '+eos],n)));
 for(const [i,id]of ['76561198000000001','RepGraphics',eos].entries())await observePlayers(f.db,f.servers[i+1],['Same Name, '+id],n);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM player_sessions').get()).n,4);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM player_profiles').get()).n,4);assert.equal((await f.db.prepare('SELECT samples FROM player_sessions WHERE server_id=?').get(f.servers[0].id)).samples,1);const games=(await f.activity.list('w',{},null,n+1)).items.map(s=>s.game).sort();assert.deepEqual(games,['asa','ase','dayz','minecraft']);
});
test('activity, rankings, events, exports and exact profile queries respect workspace and server scope',async t=>{
 const f=await fixture(t),n=f.now;await observePlayers(f.db,f.servers[0],['Allowed, '+eos],n);await observePlayers(f.db,f.servers[1],['Private Hidden, 76561198000000001'],n);const hidden=(await f.profiles.list('w',{game:'ase'})).items[0].id;
 const visible=await f.request('/player-activity','viewer');assert.equal(visible.status,200);assert.equal(visible.body.total,1);assert.ok(!JSON.stringify(visible.body).includes('Private Hidden'));const csv=await f.request('/player-activity/export','viewer');assert.equal(csv.status,200);assert.ok(!csv.body.csv.includes('Private Hidden'));assert.equal((await f.request('/player-activity?server_id='+f.servers[1].id,'viewer')).status,404);assert.equal((await f.request('/player-activity?profile_id='+hidden,'viewer')).status,404);assert.equal((await f.activity.list('other',{},null,n+1)).total,0);assert.equal((await f.activity.list('w',{},[],n+1)).total,0);assert.equal((await f.request('/player-activity','viewer','POST')).status,403);
});
test('history follows plan limits, clips overlapping duration, and closes sessions paused by a downgrade',async t=>{
 const f=await fixture(t),n=Date.now();await observePlayers(f.db,f.servers[0],['Old, '+eos],n-3*DAY);await observePlayers(f.db,f.servers[0],[],n-3*DAY+60000);await observePlayers(f.db,f.servers[2],['Current, RepGraphics'],n-60000);
 await f.db.prepare("UPDATE workspaces SET plan='scout',subscription_status='free' WHERE id='w'").run();const result=await f.activity.list('w',{days:30},null,n);assert.equal(result.days,2);assert.equal(result.retention_days,2);assert.ok(!result.items.some(s=>s.name==='Old'));assert.equal(result.summary.current_players,0);await prunePlayerActivity(f.db,await f.db.prepare("SELECT * FROM workspaces WHERE id='w'").get(),n);const rows=await f.db.prepare('SELECT * FROM player_sessions').all();assert.equal(rows.length,1);assert.equal(rows[0].end_reason,'monitoring_paused');
 // A long uninterrupted observation can span a reporting boundary; only the selected part counts.
 await f.db.prepare('UPDATE player_sessions SET started_at=?,last_seen=?,ended_at=?,end_detected_at=? WHERE id=?').run(n-3*DAY,n,n,n,rows[0].id);const clipped=await f.activity.list('w',{days:1},null,n);assert.equal(clipped.items[0].observed_ms,DAY);assert.equal(clipped.items[0].started_at,n-DAY);assert.equal(clipped.items[0].started_before_window,true);
});
test('filters, ordering and spreadsheet-safe export work without allowing arbitrary query fields',async t=>{
 const f=await fixture(t),s=f.servers[0],n=f.now;await observePlayers(f.db,s,['=HYPERLINK("test"), '+eos,'Beta, '+other],n);await observePlayers(f.db,s,['Beta, '+other],n+60000);const result=await f.activity.list('w',{sort:'longest'},null,n+60001);assert.equal(result.items[0].name,'Beta');assert.equal((await f.activity.list('w',{search:'hyperlink'},null,n+60001)).total,1);assert.equal((await f.activity.list('w',{search:'%'},null,n+60001)).total,0);const csv=await f.activity.export('w',{},null,n+60001);assert.ok(csv.csv.includes("'=HYPERLINK"));assert.equal(csv.truncated,false);assert.equal((await f.request('/player-activity?days=999')).status,400);assert.equal((await f.request('/player-activity?workspace_id=other')).status,400);
});
test('deleting a server cascades session history and snapshot state',async t=>{
 const f=await fixture(t);await observePlayers(f.db,f.servers[0],['Alpha, '+eos],f.now);await f.service.removeServer('w',f.servers[0].id);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM player_sessions').get()).n,0);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM player_presence_checks').get()).n,0);
});

test('a shared profile never leaks its hidden server names, aliases, events or estimated time',async t=>{
 const f=await fixture(t),n=f.now,s=await f.service.addServer('w',{name:'Hidden Cluster',game:'asa',map:'Island',host:'hidden.example.test',port:27020,password:'fixture',max_players:10});
 await observePlayers(f.db,f.servers[0],['Visible Alias, '+eos],n);await observePlayers(f.db,f.servers[0],['Visible Alias, '+eos],n+60000);await observePlayers(f.db,{...s,workspace_id:'w'},['Secret Alias, '+eos],n);await observePlayers(f.db,{...s,workspace_id:'w'},['Secret Alias, '+eos],n+120000);
 const profile=(await f.profiles.list('w',{search:eos})).items[0],scoped=await f.activity.list('w',{profile_id:profile.id},[f.servers[0].id],n+120001);assert.equal(scoped.summary.observed_ms,60000);assert.equal(scoped.total,1);assert.ok(!JSON.stringify(scoped).includes('Secret Alias'));assert.ok(!JSON.stringify(scoped).includes('Hidden Cluster'));assert.equal(scoped.leaders[0].name,'Visible Alias');
});

test('large history exports stay bounded and report truncation without losing filter or sort boundaries',async t=>{
 const f=await fixture(t),n=Date.now();await observePlayers(f.db,f.servers[0],['Seed, '+eos],n-10000);const profile=(await f.profiles.list('w')).items[0].id;
 await f.db.prepare("INSERT INTO player_sessions(id,workspace_id,server_id,profile_id,display_name,started_at,last_seen,samples,start_reason,ended_at,end_detected_at,end_reason) SELECT gen_random_uuid()::text,'w',?,?,'Bulk history '||i,?, ?,2,'appeared',?,?,'not_seen' FROM generate_series(1,5001) AS i").run(f.servers[0].id,profile,n-2000,n-1000,n-1000,n);
 const value=await f.activity.export('w',{search:'Bulk history',sort:'name'},[f.servers[0].id],n);assert.equal(value.truncated,true);assert.equal(value.csv.split('\r\n').length,5001);assert.ok(!value.csv.includes('"Seed"'));const empty=await f.activity.export('w',{search:'Bulk history'},[],n);assert.equal(empty.truncated,false);assert.equal(empty.csv.split('\r\n').length,1);
});
