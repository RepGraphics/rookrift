import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {once,EventEmitter} from 'node:events';
import {setImmediate as turn} from 'node:timers/promises';
import {openDatabase} from '../server/db.js';
import {createVault,hash} from '../server/crypto.js';
import {createService} from '../server/service.js';
import {createApp} from '../server/app.js';
import {createCommunity} from '../server/community.js';
import {createCommunityMembers} from '../server/community-members.js';
import {createLinkMonitor} from '../server/link-monitor.js';
import {createHostingAdapter} from '../server/hosting.js';
import {chatLinkRecord,chatLinkPlayer} from '../shared/ark-chat-link.js';
import {DEFAULT_DESIGN} from '../shared/community-design.js';
import {designSchema} from '../server/community-design.js';
import {communityTheme,COMMUNITY_PALETTES,colorContrast} from '../shared/community-theme.js';

async function fixture(t){
 const db=await openDatabase(':memory:'),vault=createVault(randomBytes(32).toString('hex')),players=new Map(),chat=new Map();
 for(const id of ['owner','alice','bob']){await db.prepare('INSERT INTO users(id,name,access_token) VALUES(?,?,?)').run(id,id,'fixture');await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(id),id,id+'-csrf',Date.now()+600000);}
 await db.prepare("INSERT INTO workspaces(id,owner_id,plan,subscription_status,created_at) VALUES('w','owner','cluster','active',1)").run();
 const service=createService(db,vault,async(server,_,action)=>action==='chat'?{output:(chat.get(server.id)||[]).shift()||''}:{output:'OK',players:players.get(server.id)||[],latency:1});
 const servers=[];for(const game of ['asa','ase'])servers.push(await service.addServer('w',{name:game.toUpperCase()+' Island',game,map:'Island',host:'8.8.8.8',port:27020,password:'fixture'}));
 const site={slug:'link-test',title:'Link Community',summary:'Welcome',rules:'Be kind.',discord_url:'',enabled:true,join_requests_open:true,staff_applications_open:false,join_questions:['Why join?'],staff_questions:['How can you help?'],server_ids:servers.map(s=>s.id)};
 const community=createCommunity(db);await community.saveSite('w',site);const app=createApp({db,vault,service,billing:{ready:false},env:{APP_URL:'http://localhost:3000'}}),http=app.listen(0,'127.0.0.1');await once(http,'listening');
 t.after(async()=>{http.closeAllConnections();await new Promise(r=>http.close(r));try{await app.locals.flushAuditWrites();}finally{await db.close();}});
 const request=async(path,method='GET',body,user='alice',csrf=true)=>{const r=await fetch('http://127.0.0.1:'+http.address().port+'/api'+path,{method,headers:{'Content-Type':'application/json',...(user?{Cookie:'rookrift_session='+user}:{}),...(csrf?{Origin:'http://localhost:3000','X-CSRF-Token':user+'-csrf'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};};
 return{db,service,players,chat,servers,site,community,app,members:app.locals.members,request};
}
const user={id:'alice'};
const codeFor=(f,index=0,who=user)=>f.members.createLinkCode('link-test',who,f.servers[index].game,f.servers[index].id);

test('native ARK account/character chat records reject nested commands and ambiguous sender names',()=>{
 const code='RR-0123456789ABCDEF';
 for(const prefix of ['Platform Name (Survivor)','Platform Name ("Survivor")','Platform Name'])assert.equal(chatLinkPlayer(chatLinkRecord(prefix+': /link '+code),['Platform Name, EOS-123']).identifier,'EOS-123');
 assert.equal(chatLinkPlayer(chatLinkRecord('Attacker: [chat] Victim: /link '+code),['Attacker, OWN-ID','Victim, VICTIM-ID']),null);
 assert.equal(chatLinkRecord('Victim: hello /link '+code),null);assert.equal(chatLinkRecord('Victim: /link '+code+' extra text'),null);
 assert.equal(chatLinkPlayer(chatLinkRecord('Victim (X): /link '+code),['Victim, ID-ONE','Victim (X), ID-TWO']),null);
 assert.equal(chatLinkPlayer(chatLinkRecord('Same (Survivor): /link '+code),['Same, ID-ONE','same, ID-TWO']),null);
 assert.equal(chatLinkPlayer(chatLinkRecord('[chat] Victim: /link '+code),['Victim, ID-ONE','[chat] Victim, ID-TWO']),null);
});

test('link codes are server-bound, hashed, private, replaceable, expiring and consumed atomically',async t=>{
 const f=await fixture(t),server=f.servers[0];f.players.set(server.id,['Platform Name, EOS-123']);
 const old=await codeFor(f),code=await codeFor(f);assert.notEqual(old.code,code.code);const row=await f.db.prepare('SELECT * FROM community_link_codes WHERE user_id=?').get(user.id);assert.equal(row.code_hash,hash(code.code));assert.ok(!JSON.stringify(row).includes(code.code));
 assert.equal((await f.members.ingestServerChat(server.id,'Platform Name (Survivor): '+old.command)).linked,false);
 assert.equal((await f.members.ingestServerChat(f.servers[1].id,'Platform Name: '+code.command)).linked,false);
 await f.service.action('w',server.id,'status');
 const concurrent=createCommunityMembers(f.db,{service:{action:async()=>{},getServer:(...args)=>f.service.getServer(...args)}});
 const results=await Promise.all([concurrent.ingestServerChat(server.id,'Platform Name (Survivor): '+code.command),concurrent.ingestServerChat(server.id,'Platform Name (Survivor): '+code.command)]);assert.equal(results.filter(r=>r.linked).length,1);
 const own=await f.members.view('link-test',user);assert.equal(own.accounts[0].identifier,'EOS-123');assert.equal(own.accounts[0].verified,1);assert.equal(own.accounts[0].verified_server_id,server.id);assert.ok(own.link_request.used_at);assert.equal((await f.members.view('link-test',{id:'bob'})).accounts.length,0);
 const expired=await codeFor(f);await f.db.prepare('UPDATE community_link_codes SET expires_at=1 WHERE code_hash=?').run(hash(expired.code));assert.equal((await f.members.ingestServerChat(server.id,'Platform Name: '+expired.command)).linked,false);
});

test('RCON linking works without a hosting console and retries a busy verification without losing the chat record',async t=>{
 const f=await fixture(t),code=await codeFor(f),id=f.servers[0].id;f.players.set(id,['Player One, PLAYER-001']);f.chat.set(id,['Player One (Survivor): '+code.command]);let blocked=true,consoleCalls=0;
 const monitor=createLinkMonitor(f.db,{serverChat:s=>f.service.chat('w',s),hostingConsole:async()=>{consoleCalls++;throw new Error('No console');}},{ingestServerChat:async(...args)=>{if(blocked){blocked=false;throw Object.assign(new Error('Busy'),{code:'SERVER_BUSY'});}return f.members.ingestServerChat(...args);}},{autoStart:false});t.after(()=>monitor.stop());
 await monitor.tick();assert.equal((await f.members.view('link-test',user)).accounts.length,0);await monitor.tick();assert.equal((await f.members.view('link-test',user)).accounts[0].identifier,'PLAYER-001');assert.equal(consoleCalls,0);assert.ok(monitor.status(id).last_linked_at);
});

test('link HTTP routes enforce authentication, CSRF, target scope and trusted controller credentials',async t=>{
 const f=await fixture(t),id=f.servers[0].id,base='/public/communities/link-test/member';
 assert.equal((await f.request(base+'/link-code','POST',{game:'asa',server_id:id},null)).status,401);assert.equal((await f.request(base+'/link-code','POST',{game:'asa',server_id:id},'alice',false)).status,403);assert.equal((await f.request(base+'/link-code','POST',{game:'asa',server_id:randomUUID()})).status,400);
 const code=(await f.request(base+'/link-code','POST',{game:'asa',server_id:id})).body;f.players.set(id,['Trusted Player, PLAYER-001']);await f.db.prepare('UPDATE servers SET link_ingest_token_hash=? WHERE id=?').run(hash('server-fixture-token'),id);
 await assert.rejects(f.members.ingestChatEvent('wrong-token',{server_id:id,code:code.code,identifier:'PLAYER-001'}),/credentials/);
 assert.equal((await f.members.ingestChatEvent('server-fixture-token',{server_id:id,message:'Trusted Player: '+code.command})).linked,false);
 assert.equal((await f.members.ingestChatEvent('server-fixture-token',{server_id:id,code:code.code,identifier:'NOT-ONLINE'})).linked,false);
 assert.equal((await f.members.ingestChatEvent('server-fixture-token',{server_id:id,code:code.code,identifier:'PLAYER-001'})).linked,true);
 const second=await codeFor(f,0,{id:'bob'});await assert.rejects(f.members.ingestServerChat(id,'Trusted Player: '+second.command),/another member/);
 assert.equal((await f.request(base,'GET',null,'bob')).body.accounts.length,0);
});

test('community logos survive the public DTO and large supported uploads, while unsafe image URLs are rejected',async t=>{
 const f=await fixture(t),logo='data:image/png;base64,'+Buffer.alloc(90000).toString('base64');
 assert.equal((await f.request('/community/site','PUT',{...f.site,logo_url:logo},'owner')).status,200);const page=await f.request('/public/communities/link-test','GET',null,null);assert.equal(page.body.site.logo_url,logo);
 await assert.rejects(f.community.saveSite('w',{...f.site,logo_url:'data:image/svg+xml;base64,PHN2Zz4='}));await assert.rejects(f.community.saveSite('w',{...f.site,logo_url:'https://user:password@example.com/logo.png'}));
});

test('appearance defaults preserve old pages and all theme modes keep readable text and buttons',()=>{
 const old=designSchema.parse(DEFAULT_DESIGN);assert.equal(old.appearance.mode,'dark');assert.deepEqual(old.pages,DEFAULT_DESIGN.pages);
 for(const theme of Object.keys(COMMUNITY_PALETTES))for(const mode of ['dark','light'])for(const accent of ['', '#ffffff','#000000','#ffd166','#777777','#0600ff']){const p=communityTheme({theme,appearance:{mode,accent}});for(const key of ['--text','--heading','--muted','--accent'])assert.ok(colorContrast(p[key],p['--panel'])>=4.5,theme+' '+mode+' '+key);assert.ok(colorContrast(p['--on-primary'],p['--primary'])>=4.5);assert.ok(colorContrast(p['--on-primary'],p['--primary-hover'])>=4.5);}
 assert.equal(designSchema.safeParse({...DEFAULT_DESIGN,appearance:{accent:'red; color: white'}}).success,false);assert.equal(designSchema.safeParse({...DEFAULT_DESIGN,appearance:{hero_image_url:'javascript:alert(1)'}}).success,false);
});

test('panel console waits for authentication, fetches a fresh expiring token and preserves close callbacks',async()=>{
 const sockets=[],calls=[],closed=[];
 class Socket extends EventEmitter{constructor(url){super();this.url=url;this.readyState=1;sockets.push(this);}send(raw){calls.push(JSON.parse(raw));}terminate(){this.readyState=3;this.emit('close');}}
 let sessions=0;const adapter=createHostingAdapter(async()=>({data:{socket:'wss://wings.example.test/api/servers/example/ws',token:'new-token-'+(++sessions)}}),{WebSocketImpl:Socket,resolveSocket:async()=> '8.8.8.8'}),lines=[];
 const opening=adapter.openConsole({provider:'pterodactyl',origin:'https://panel.example.test',remote_id:'example',key:'fixture'},line=>lines.push(line),()=>closed.push(true));await turn();const socket=sockets[0];socket.emit('open');assert.equal(calls[0].args[0],'new-token-1');assert.ok(!calls.some(c=>c.event==='send logs'));socket.emit('message',JSON.stringify({event:'auth success'}));const close=await opening;assert.ok(calls.some(c=>c.event==='send logs'));
 socket.emit('message',JSON.stringify({event:'token expiring'}));await turn();assert.equal(sessions,2);assert.equal(calls.at(-1).args[0],'new-token-2');socket.emit('message',JSON.stringify({event:'console output',args:['first\nsecond']}));assert.deepEqual(lines,['first','second']);close();assert.equal(closed.length,1);
});
