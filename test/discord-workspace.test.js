import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {openDatabase} from '../server/db.js';
import {createVault,hash} from '../server/crypto.js';
import {createService} from '../server/service.js';
import {createApp} from '../server/app.js';
import {PermissionFlagsBits} from 'discord.js';

const guild='123456789012345678',channel='223456789012345678',person='323456789012345678';
async function fixture(t){
 const db=await openDatabase(':memory:'),vault=createVault(randomBytes(32).toString('hex')),state={ready:true,permissions:true,userPermissions:'32',oauthStatus:200,guildCalls:0,sends:0,channelGuild:guild,text:true,token:''};
 for(const id of ['local','root']){await db.prepare('INSERT INTO users(id,name,access_token) VALUES(?,?,?)').run(id,id,'');await db.prepare('INSERT INTO workspaces(id,owner_id,name,created_at) VALUES(?,?,?,1)').run(id+'-ws',id,id+' workspace');await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(id),id,id+'-csrf',Date.now()+600000);}
 await db.prepare("INSERT INTO platform_admins VALUES('root',1)").run();
 const bot={
  user:{id:'423456789012345678'},isReady:()=>state.ready,
  guilds:{fetch:async id=>{state.guildCalls++;if(id!==guild)throw new Error('Not a member');return{id,name:'Our Discord',members:{fetchMe:async()=>({id:'bot-member'})}};}},
  channels:{fetch:async()=>({id:channel,guildId:state.channelGuild,isTextBased:()=>state.text,isThread:()=>false,send:async()=>{state.sends++;},permissionsFor:()=>({has:bits=>{assert.ok(bits.includes(PermissionFlagsBits.ViewChannel));assert.ok(bits.includes(PermissionFlagsBits.SendMessages));return state.permissions;}})})}
 };
 const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{const target=String(url);if(target==='https://discord.com/api/v10/oauth2/token')return new Response(JSON.stringify({access_token:'fresh-token'}),{status:200,headers:{'Content-Type':'application/json'}});if(target==='https://discord.com/api/v10/users/@me')return new Response(JSON.stringify({id:person,username:'Discord owner',avatar:null}),{status:200,headers:{'Content-Type':'application/json'}});if(target==='https://discord.com/api/v10/users/@me/guilds'){state.token=options.headers.Authorization;return new Response(JSON.stringify([{id:guild,name:'Our Discord',permissions:state.userPermissions}]),{status:state.oauthStatus,headers:{'Content-Type':'application/json'}});}return original(url,options);};
 const env={APP_URL:'http://localhost:3000',DISCORD_CLIENT_ID:'fixture',DISCORD_CLIENT_SECRET:'fixture',DISCORD_REDIRECT_URI:'http://localhost:3000/auth/discord/callback'},service=createService(db,vault,async()=>({output:'OK',players:[],latency:1})),app=createApp({db,vault,service,billing:{ready:false,accountHistory:async()=>[]},getBot:()=>bot,env}),http=app.listen(0,'127.0.0.1');await once(http,'listening');const base='http://127.0.0.1:'+http.address().port;
 t.after(async()=>{globalThis.fetch=original;http.closeAllConnections();await new Promise(r=>http.close(r));await app.locals.flushAuditWrites();await db.close();});
 const request=async(body,user='local',csrf=true)=>{const response=await fetch(base+'/api/workspace',{method:'PATCH',headers:{Cookie:'rookrift_session='+user,'Content-Type':'application/json',Origin:env.APP_URL,...(csrf?{'X-CSRF-Token':user+'-csrf'}:{})},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
 return{db,vault,state,base,request,input:{name:'Updated workspace',guild_id:guild,alert_channel_id:channel,alerts_enabled:true,failure_threshold:2}};
}

test('a local account gets a reconnect action instead of a token-decryption server error',async t=>{
 const f=await fixture(t),result=await f.request(f.input);assert.equal(result.status,409);assert.match(result.body.error,/Connect your Discord/);assert.equal((await f.db.prepare("SELECT guild_id FROM workspaces WHERE id='local-ws'").get()).guild_id,null);assert.equal(f.state.guildCalls,0);const rename=await f.request({name:'Renamed only',alerts_enabled:false});assert.equal(rename.status,200);
});

test('Discord linking requests server access, stores its encrypted token and returns to the original settings page',async t=>{
 const f=await fixture(t),begin=await fetch(f.base+'/auth/discord/link?return_to=%2Fdashboard%3Fsettings%3Ddiscord',{redirect:'manual',headers:{Cookie:'rookrift_session=local'}}),url=new URL(begin.headers.get('Location'));assert.equal(url.searchParams.get('scope'),'identify guilds');const state=url.searchParams.get('state'),callback=await fetch(f.base+'/auth/discord/callback?code=fixture&state='+state,{redirect:'manual',headers:{Cookie:'rookrift_session=local; rookrift_oauth_link='+state+'; rookrift_link_return=%2Fdashboard%3Fsettings%3Ddiscord'}});assert.equal(callback.status,302);assert.equal(callback.headers.get('Location'),'http://localhost:3000/dashboard?settings=discord');const user=await f.db.prepare("SELECT discord_id,access_token FROM users WHERE id='local'").get();assert.equal(user.discord_id,person);assert.notEqual(user.access_token,'fresh-token');assert.equal(f.vault.decrypt(user.access_token),'fresh-token');assert.equal((await f.request(f.input)).status,200);assert.equal(f.state.token,'Bearer fresh-token');const saved=await f.db.prepare("SELECT * FROM workspaces WHERE id='local-ws'").get();assert.equal(saved.guild_id,guild);assert.equal(saved.alert_channel_id,channel);assert.equal(saved.guild_name,'Our Discord');assert.equal(f.state.sends,0);
});

test('platform roots can save through the bot without a personal Discord token, while bad channels and missing permissions fail clearly',async t=>{
 const f=await fixture(t);assert.equal((await f.request({...f.input,guild_id:' '+guild+' ',alert_channel_id:'\n'+channel+' '},'root')).status,200);assert.equal(f.state.token,'');assert.equal((await f.db.prepare("SELECT guild_id FROM workspaces WHERE id='root-ws'").get()).guild_id,guild);
 await f.db.prepare("UPDATE workspaces SET guild_id=NULL,alert_channel_id=NULL WHERE id='root-ws'").run();f.state.channelGuild='523456789012345678';const wrong=await f.request(f.input,'root');assert.equal(wrong.status,400);assert.match(wrong.body.error,/selected Discord server/);f.state.channelGuild=guild;f.state.permissions=false;const denied=await f.request(f.input,'root');assert.equal(denied.status,403);assert.match(denied.body.error,/View Channel and Send Messages/);assert.equal((await f.db.prepare("SELECT guild_id FROM workspaces WHERE id='root-ws'").get()).guild_id,null);
});

test('expired authorization, missing Manage Server permission and offline bot preserve previous settings',async t=>{
 const f=await fixture(t);await f.db.prepare("UPDATE users SET access_token=? WHERE id='local'").run(f.vault.encrypt('old-token'));f.state.oauthStatus=403;assert.equal((await f.request(f.input)).status,409);f.state.oauthStatus=200;f.state.userPermissions='0';assert.equal((await f.request(f.input)).status,403);f.state.userPermissions='32';f.state.ready=false;const offline=await f.request(f.input);assert.equal(offline.status,503);assert.match(offline.body.error,/bot is offline/);assert.equal((await f.db.prepare("SELECT name FROM workspaces WHERE id='local-ws'").get()).name,'local workspace');
});

test('guild conflicts, orphan channels, role spoofing and CSRF are rejected without partial writes',async t=>{
 const f=await fixture(t);await f.db.prepare("UPDATE workspaces SET guild_id=? WHERE id='root-ws'").run(guild);assert.equal((await f.request(f.input)).status,409);assert.equal((await f.request({...f.input,guild_id:null})).status,400);assert.equal((await f.request({...f.input,platform_admin:true})).status,400);assert.equal((await f.request(f.input,'root',false)).status,403);assert.equal((await f.db.prepare("SELECT alert_channel_id FROM workspaces WHERE id='local-ws'").get()).alert_channel_id,null);
});

test('Discord callbacks cannot attach credentials to a different or expired local session, and return links stay internal',async t=>{
 const f=await fixture(t),begin=await fetch(f.base+'/auth/discord/link?return_to=https%3A%2F%2Fevil.example',{redirect:'manual',headers:{Cookie:'rookrift_session=local'}}),state=new URL(begin.headers.get('Location')).searchParams.get('state');assert.ok(begin.headers.getSetCookie().some(c=>c.startsWith('rookrift_link_return=%2Fdashboard%3Faccount%3Ddiscord')));const wrong=await fetch(f.base+'/auth/discord/callback?code=fixture&state='+state,{redirect:'manual',headers:{Cookie:'rookrift_session=root; rookrift_oauth_link='+state}});assert.equal(wrong.status,401);assert.equal((await f.db.prepare("SELECT access_token FROM users WHERE id='local'").get()).access_token,'');
});
