import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {openDatabase} from '../server/db.js';
import {createVault,hash} from '../server/crypto.js';
import {createService} from '../server/service.js';
import {createApp} from '../server/app.js';
import {avatarSource,avatarInitials} from '../shared/avatar.js';
import {userAvatarUrl,avatarImage} from '../server/avatars.js';

const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nWQAAAAASUVORK5CYII=',image='data:image/png;base64,'+pixel,discord='123456789012345678';
async function fixture(t){
 const db=await openDatabase(':memory:'),vault=createVault(randomBytes(32).toString('hex'));
 for(const id of ['owner','member','other','root',discord]){await db.prepare('INSERT INTO users(id,name,access_token,avatar) VALUES(?,?,?,?)').run(id,id,'private-token',image);await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(id),id,id+'-csrf',Date.now()+600000);}
 await db.prepare("INSERT INTO workspaces(id,owner_id,plan,subscription_status,created_at) VALUES('ws','owner','cluster','active',1)").run();await db.prepare("INSERT INTO platform_admins VALUES('root',1)").run();await db.prepare("INSERT INTO workspace_members VALUES(?,'ws','member','viewer',NULL,1)").run(randomUUID());await db.prepare("INSERT INTO community_sites(workspace_id,slug,title,enabled,updated_at) VALUES('ws','our-community','Our community',1,1)").run();
 const env={APP_URL:'http://localhost:3000',DISCORD_CLIENT_ID:'fixture',DISCORD_CLIENT_SECRET:'fixture',DISCORD_REDIRECT_URI:'http://localhost:3000/auth/discord/callback'},service=createService(db,vault,async()=>({output:'OK',players:[],latency:1})),app=createApp({db,vault,service,billing:{ready:false,accountHistory:async()=>[]},env}),http=app.listen(0,'127.0.0.1');await once(http,'listening');const base='http://127.0.0.1:'+http.address().port;
 t.after(async()=>{http.closeAllConnections();await new Promise(r=>http.close(r));await app.locals.flushAuditWrites();await db.close();});
 const request=async(path,method='GET',body,user='owner')=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(user?{Cookie:'rookrift_session='+user,Origin:env.APP_URL,'X-CSRF-Token':user+'-csrf'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json(),headers:response.headers};};return{db,app,base,env,request};
}

test('avatar sources resolve only supported uploads, protected images and valid Discord identities',()=>{
 assert.equal(avatarSource({avatar:image}),image);assert.equal(avatarSource({id:discord,avatar:'f'.repeat(32)}),'https://cdn.discordapp.com/avatars/'+discord+'/'+'f'.repeat(32)+'.png?size=128');assert.match(avatarSource({id:'local',discord_id:discord,avatar:'a_'+'a'.repeat(32)}),/\.gif\?size=128$/);assert.equal(avatarSource({avatar:'javascript:alert(1)'}),null);assert.equal(avatarSource({avatar_url:'https://tracking.example/photo.png'}),null);assert.equal(avatarSource({avatar:'data:image/svg+xml;base64,PHN2Zz4='}),null);assert.equal(avatarSource({id:'local',avatar:'f'.repeat(32)}),null);assert.equal(avatarInitials('  Alex   Morgan  '),'AM');assert.equal(avatarInitials(''),'?' );assert.equal(avatarImage(image).type,'image/png');
});

test('uploads larger than the old JSON limit save, return lightweight metadata, preserve on name edits and can be removed',async t=>{
 const f=await fixture(t),large='data:image/png;base64,'+Buffer.concat([Buffer.from(pixel,'base64'),Buffer.alloc(100000)]).toString('base64');const saved=await f.request('/api/account/profile','PATCH',{name:'New owner',username:'new_owner',avatar:large});assert.equal(saved.status,200);assert.match(saved.body.profile.avatar_url,/^\/api\/account\/avatars\/owner\?v=[a-f0-9]{24}$/);assert.ok(!JSON.stringify(saved.body).includes('data:image/'));assert.equal(saved.body.profile.avatar,undefined);const unchanged=await f.request('/api/account/profile','PATCH',{name:'Another owner',username:'new_owner'});assert.equal(unchanged.body.profile.avatar_url,saved.body.profile.avatar_url);assert.equal((await f.db.prepare("SELECT avatar FROM users WHERE id='owner'").get()).avatar,large);const removed=await f.request('/api/account/profile','PATCH',{name:'Another owner',username:'new_owner',avatar:null});assert.equal(removed.body.profile.avatar_url,null);assert.equal((await fetch(f.base+saved.body.profile.avatar_url,{headers:{Cookie:'rookrift_session=owner'}})).status,404);
});

test('profile images require self, owned-team or root access, cache privately and recheck revoked access',async t=>{
 const f=await fixture(t),url=userAvatarUrl({id:'member',avatar:image});assert.equal((await fetch(f.base+url)).status,401);assert.equal((await fetch(f.base+url,{headers:{Cookie:'rookrift_session=other'}})).status,404);const visible=await fetch(f.base+url,{headers:{Cookie:'rookrift_session=owner'}});assert.equal(visible.status,200);assert.equal(visible.headers.get('Content-Type'),'image/png');assert.match(visible.headers.get('Cache-Control'),/private.*no-cache/);assert.deepEqual(Buffer.from(await visible.arrayBuffer()),Buffer.from(pixel,'base64'));const tag=visible.headers.get('ETag');assert.equal((await fetch(f.base+url,{headers:{Cookie:'rookrift_session=owner','If-None-Match':tag}})).status,304);assert.equal((await fetch(f.base+url,{headers:{Cookie:'rookrift_session=member'}})).status,200);assert.equal((await fetch(f.base+url,{headers:{Cookie:'rookrift_session=root'}})).status,200);await f.db.prepare("DELETE FROM workspace_members WHERE user_id='member'").run();assert.equal((await fetch(f.base+url,{headers:{Cookie:'rookrift_session=owner','If-None-Match':tag}})).status,404);
});

test('dashboard, team, platform and signed-in community DTOs expose current pictures without raw upload bodies',async t=>{
 const f=await fixture(t),dashboard=await f.request('/api/bootstrap');assert.match(dashboard.body.user.avatar_url,/avatars\/owner/);const team=await f.request('/api/team');assert.match(team.body.members[0].avatar_url,/avatars\/member/);assert.equal(team.body.members[0].avatar,undefined);const admin=await f.request('/api/platform/bootstrap','GET',null,'root');assert.match(admin.body.user.avatar_url,/avatars\/root/);assert.ok(admin.body.users.every(u=>u.avatar_url&&!u.avatar));assert.ok(!JSON.stringify(admin.body).includes('data:image/'));const publicPage=await f.request('/api/public/communities/our-community');assert.match(publicPage.body.viewer.avatar_url,/avatars\/owner/);const anonymous=await f.request('/api/public/communities/our-community','GET',null,null);assert.equal(anonymous.body.viewer,null);assert.ok(!JSON.stringify(anonymous.body).includes('/api/account/avatars/'));
});

test('linked Discord avatar hashes render and survive ordinary profile edits',async t=>{
 const f=await fixture(t);await f.db.prepare("UPDATE users SET avatar=?,discord_id=? WHERE id='owner'").run('a_'+'d'.repeat(32),discord);const current=await f.request('/api/account');assert.equal(current.body.profile.avatar_url,'https://cdn.discordapp.com/avatars/'+discord+'/a_'+'d'.repeat(32)+'.gif?size=128');const updated=await f.request('/api/account/profile','PATCH',{name:'Linked owner',username:'linked_owner'});assert.equal(updated.status,200);assert.equal(updated.body.profile.avatar_url,current.body.profile.avatar_url);assert.equal((await f.request('/api/account/profile','PATCH',{name:'Linked owner',username:'linked_owner',avatar:'https://example.com/image.png'})).status,400);
});

test('profile upload validation retains the 3 MB decoded limit and rejects non-raster content',async t=>{
 const f=await fixture(t);for(const avatar of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,'+Buffer.alloc(3*1024*1024+1).toString('base64')])assert.equal((await f.request('/api/account/profile','PATCH',{name:'Owner',username:'owner_name',avatar})).status,400);assert.equal((await f.db.prepare("SELECT avatar FROM users WHERE id='owner'").get()).avatar,image);
});

test('Discord sign-in refreshes provider details without replacing an uploaded picture',async t=>{
 const f=await fixture(t),original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});globalThis.fetch=async(url,options)=>{if(String(url)==='https://discord.com/api/v10/oauth2/token')return new Response(JSON.stringify({access_token:'fixture-token'}),{status:200,headers:{'Content-Type':'application/json'}});if(String(url)==='https://discord.com/api/v10/users/@me')return new Response(JSON.stringify({id:discord,username:'Discord user',avatar:'b'.repeat(32)}),{status:200,headers:{'Content-Type':'application/json'}});return original(url,options);};const begin=await fetch(f.base+'/auth/discord',{redirect:'manual'}),state=new URL(begin.headers.get('Location')).searchParams.get('state'),callback=await fetch(f.base+'/auth/discord/callback?code=fixture&state='+state,{redirect:'manual',headers:{Cookie:'rookrift_oauth='+state}});assert.equal(callback.status,302);const saved=await f.db.prepare('SELECT name,avatar FROM users WHERE id=?').get(discord);assert.equal(saved.name,'Discord user');assert.equal(saved.avatar,image);
});
