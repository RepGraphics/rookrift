import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import Stripe from 'stripe';
import {openDatabase} from '../server/db.js';
import {createVault,hash} from '../server/crypto.js';
import {createService} from '../server/service.js';
import {createCommunity} from '../server/community.js';
import {createCommunityStore} from '../server/community-store.js';
import {createApp} from '../server/app.js';
import {DEFAULT_DESIGN} from '../shared/community-design.js';
import {ensurePersonalWorkspace} from '../server/workspaces.js';
import {handleStoreInteraction} from '../server/store-discord.js';
import {commandDefinitions} from '../server/bot.js';
import {MessageFlags,PermissionFlagsBits} from 'discord.js';
import {discordRegistrationConfig} from '../server/discord-registration.js';

async function fixture(t,options={}){
 const commands=[],awards=[],mailed=[];const db=await openDatabase(':memory:'),vault=createVault(randomBytes(32).toString('hex')),sessions=new Map();let creates=0,uncertain=false;
 for(const id of ['owner','buyer','other','admin','mod','scoped','123456789012345678']){await db.prepare('INSERT INTO users VALUES(?,?,NULL,?)').run(id,id,'private-token');await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(id),id,id+'-csrf',Date.now()+600000);}
 await db.prepare("INSERT INTO workspaces(id,owner_id,plan,subscription_status,created_at) VALUES('w','owner','cluster','active',1)").run();
 for(const [id,role,scope]of [['admin','admin',null],['mod','moderator',null],['scoped','admin','[]']])await db.prepare("INSERT INTO workspace_members VALUES(?,'w',?,?,?,1)").run(randomUUID(),id,role,scope);
 const stripe={webhooks:new Stripe('sk_test_fixture').webhooks,accounts:{create:async()=>({id:'acct_fixture'}),retrieve:async()=>({id:'acct_fixture',charges_enabled:true})},accountLinks:{create:async()=>({url:'https://connect.stripe.com/setup/test'})},checkout:{sessions:{
  create:async(input,options)=>{creates++;assert.equal(input.automatic_payment_methods,undefined,'Checkout uses dashboard-configured methods; PaymentIntent-only fields are invalid here.');assert.equal(options.stripeAccount,'acct_fixture');assert.equal(options.idempotencyKey,'community-order-'+input.client_reference_id);let s=[...sessions.values()].find(s=>s.client_reference_id===input.client_reference_id);if(!s){s={id:'cs_'+input.client_reference_id,mode:'payment',client_reference_id:input.client_reference_id,metadata:input.metadata,amount_total:input.line_items[0].price_data.unit_amount,currency:input.line_items[0].price_data.currency,payment_status:'unpaid',status:'open',url:'https://checkout.stripe.com/c/pay/test'};sessions.set(s.id,s);}if(uncertain){uncertain=false;throw new Error('Lost response after Stripe accepted checkout');}return s;},
  retrieve:async(id,params,options)=>{assert.equal(options.stripeAccount,'acct_fixture');return sessions.get(id);},
  expire:async(id)=>{const session=sessions.get(id);if(session.status!=='open')throw new Error('Cannot expire a completed session');session.status='expired';return session;}
 }}};
 const env={APP_URL:'http://localhost:3000',STRIPE_CONNECT_WEBHOOK_SECRET:'whsec_community_fixture'},store=createCommunityStore(db,env,stripe),service=createService(db,vault,async(server,vault,action,message)=>{options.calls?.push({game:server.game,action});if(action==='purchase'){commands.push({server_id:server.id,command:message});if(options.failCommand)throw new Error('Lost RCON reply');}return{output:'OK',players:options.players?options.players(server):[],latency:1};}),community=createCommunity(db);
 const site={slug:'test-community',title:'Test Community',summary:'Welcome',rules:'Be kind.',discord_url:'',enabled:true,join_requests_open:true,staff_applications_open:false,join_questions:['Why join us?'],staff_questions:['What can you offer the team?'],server_ids:[]};await community.saveSite('w',site);
 const rewards={roles:async()=>[{id:'223456789012345670',name:'Supporter'}],check:async(guild,id)=>{if(id!=='223456789012345670')throw Object.assign(new Error('Role is not assignable.'),{status:409});return 'Supporter';},award:async(guild,role,user,id)=>{awards.push({guild,role,user,id});return{preexisting:false};}};
 const app=createApp({db,vault,service,store,rewards,billing:{ready:false},env}),http=app.listen(0,'127.0.0.1');await once(http,'listening');store.setEmail({storePaid:async order=>mailed.push(order.id)});
 t.after(async()=>{http.closeAllConnections();await new Promise(r=>http.close(r));await app.locals.flushAuditWrites();await db.close();});
 const request=async(path,method='GET',body,user='owner',csrf=true)=>{const r=await fetch('http://127.0.0.1:'+http.address().port+'/api'+path,{method,headers:{'Content-Type':'application/json',...(user?{Cookie:'rookrift_session='+user}:{}),...(csrf?{Origin:env.APP_URL,'X-CSRF-Token':user+'-csrf'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};};
 const settings={enabled:true,currency:'gbp',country:'GB',delivery_note:'Contact staff in Discord. Delivery within 24 hours.',refund_policy:'Contact staff before delivery to request a refund.'};
 async function openStore(){await store.settings('w',settings);await store.connect('w');await store.refreshAccount('w');await store.product('w',null,{title:'Starter kit',description:'A building starter kit delivered by staff.',price:500,game:'asa',published:true});return(await store.manage('w')).products[0];}
 const pay=id=>{const s=sessions.get(id);s.payment_status='paid';s.status='complete';s.payment_intent={id:'pi_'+s.client_reference_id,status:'succeeded',latest_charge:{id:'ch_'+s.client_reference_id,amount:s.amount_total,currency:s.currency,amount_refunded:0,disputed:false}};return s;};
 async function event(object,type='checkout.session.completed',account='acct_fixture',id=randomUUID()) {const body=JSON.stringify({id,type,account,data:{object}}),signature=stripe.webhooks.generateTestHeaderString({payload:body,secret:env.STRIPE_CONNECT_WEBHOOK_SECRET});const r=await fetch('http://127.0.0.1:'+http.address().port+'/api/webhooks/community-stripe',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body});return r.status;}
 return{db,vault,service,store,community,site,request,openStore,settings,sessions,pay,event,commands,awards,mailed,delivery:app.locals.delivery,get creates(){return creates;},loseResponse(){uncertain=true;}};
}

const promotionInput=(extra={})=>({name:'Welcome discount',kind:'coupon',code:'WELCOME10',discount_type:'percent',discount_value:10,minimum_amount:0,product_ids:[],category_ids:[],starts_at:null,ends_at:null,usage_limit:null,customer_limit:null,enabled:true,...extra});
const availabilityInput=(extra={})=>({stock_limit:null,customer_limit:null,available_from:null,available_until:null,...extra});

test('Minecraft and DayZ workspaces connect, retain separate profile namespaces and reject unsupported actions before sending',async t=>{
 const calls=[],f=await fixture(t,{calls,players:server=>server.game==='minecraft'?['Steve, Steve']:['Survivor, aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']});await f.db.prepare("UPDATE workspaces SET game_focus='minecraft' WHERE id='w'").run();const input={name:'Java world',game:'minecraft',map:'world',host:'8.8.8.8',port:25575,password:'fixture'};const mc=await f.service.addServer('w',input);await assert.rejects(f.service.addServer('w',{...input,game:'dayz'}),/focus/);await f.db.prepare("UPDATE workspaces SET game_focus='mixed' WHERE id='w'").run();const dz=await f.service.addServer('w',{...input,name:'DayZ world',game:'dayz',map:'Chernarus',port:2306});await f.service.action('w',mc.id,'status');await f.service.action('w',dz.id,'status');const profiles=await f.db.prepare("SELECT game,identity_kind FROM player_profiles WHERE workspace_id='w' ORDER BY game").all();assert.deepEqual(profiles,[{game:'dayz',identity_kind:'battleye'},{game:'minecraft',identity_kind:'minecraft'}]);calls.length=0;await assert.rejects(f.service.bulkAction('w',{server_ids:[mc.id,dz.id],action:'save'}),/does not support/);assert.equal(calls.length,0);await assert.rejects(f.service.addSchedule('w',{server_id:dz.id,name:'Invalid manual save',action:'save'}),/does not support/);assert.equal((await f.request('/workflows','POST',{server_id:dz.id,name:'Invalid DayZ save',steps:[{type:'save'}]})).status,400);assert.equal(calls.length,0);
});
test('new game catalogs and delivery identities use Java usernames and BattlEye GUIDs without claiming native chat verification',async t=>{
 const f=await fixture(t);await f.openStore();for(const [game,identifier]of [['minecraft','Steve'],['dayz','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']]){const saved=await f.store.product('w',null,{title:game+' supporter',description:'A community supporter benefit delivered by staff.',price:0,game,published:true}),p=saved.products.find(p=>p.id===saved.saved_product_id);const visible=(await f.store.publicPage(f.site.slug,{id:'buyer'})).products.find(v=>v.id===p.id);assert.equal(visible.delivery.identifier_kind,game==='minecraft'?'minecraft':'battleye');const account=await f.request('/public/communities/'+f.site.slug+'/member/game-accounts','POST',{game,identifier,label:'Main account'},'buyer');assert.equal(account.status,200);const linked=account.body.accounts.find(a=>a.game===game);assert.equal(linked.verified,0);const order=await f.store.checkout(f.site.slug,{id:'buyer'},{product_id:p.id,account_id:linked.id,request_id:randomUUID()});assert.equal(order.free,true);}
 assert.equal((await f.request('/public/communities/'+f.site.slug+'/member/game-accounts','POST',{game:'minecraft',identifier:'not a valid name',label:''},'buyer')).status,400);assert.equal((await f.request('/public/communities/'+f.site.slug+'/member/link-code','POST',{game:'minecraft',server_id:randomUUID()},'buyer')).status,400);assert.equal(f.commands.length,0);
});
test('online purchase actions stay pending without an execution attempt until a fresh native player list matches the recipient',async t=>{
 let online=false;const f=await fixture(t,{players:()=>online?['Steve, Steve']:[]}),p=await f.openStore();await f.store.product('w',p.id,{title:p.title,description:p.description,price:0,game:'minecraft',published:true});const server=await f.service.addServer('w',{name:'Java delivery',game:'minecraft',map:'world',host:'8.8.8.8',port:25575,password:'fixture'});await f.db.prepare("UPDATE servers SET status='online',last_checked=? WHERE id=?").run(Date.now(),server.id);const configured=await f.request('/community/store/products/'+p.id+'/actions','PUT',{confirmation:p.title,actions:[{type:'rcon',server_id:server.id,identity_kind:'minecraft',command_template:'give {identifier} minecraft:stone 1',require_online:true}]});assert.equal(configured.status,200);const checkout=await f.store.checkout(f.site.slug,{id:'buyer'},{product_id:p.id,identifier:'Steve',request_id:randomUUID()});await f.delivery.tick();let job=await f.db.prepare('SELECT * FROM store_delivery_jobs WHERE order_id=?').get(checkout.order_id);assert.equal(job.status,'pending');assert.equal(job.attempts,0);assert.match(job.detail,/recipient/);assert.equal(f.commands.length,0);online=true;await f.db.prepare('UPDATE store_delivery_jobs SET next_attempt=0 WHERE id=?').run(job.id);await f.delivery.tick();job=await f.db.prepare('SELECT * FROM store_delivery_jobs WHERE id=?').get(job.id);assert.equal(job.status,'succeeded');assert.equal(job.attempts,1);assert.equal(f.commands[0].command,'give Steve minecraft:stone 1');await f.delivery.tick();assert.equal(f.commands.length,1);
});

test('new-game moderation requires the native namespace and rejects unsupported DayZ unbans',async t=>{
 const f=await fixture(t,{players:s=>s.game==='minecraft'?['Steve, Steve']:['Survivor, aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']});for(const game of ['minecraft','dayz']){const server=await f.service.addServer('w',{name:game+' moderation',game,map:'Test',host:'8.8.8.8',port:game==='minecraft'?25575:2306,password:'fixture'});await f.service.action('w',server.id,'status');const input={server_id:server.id,identifier:game==='minecraft'?'Steve':'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',action:'ban',reason:'Test rule enforcement'};if(game==='dayz')assert.equal((await f.request('/moderation','POST',{...input,identity_kind:'eos'})).status,400);const result=await f.request('/moderation','POST',input);assert.equal(result.status,200);const record=await f.db.prepare('SELECT identity_kind FROM moderation WHERE server_id=?').get(server.id);assert.equal(record.identity_kind,game==='minecraft'?'minecraft':'battleye');if(game==='dayz')assert.equal((await f.request('/moderation','POST',{...input,action:'unban'})).status,400);}
});

test('platform workspace support is root-only, uses stored state and excludes connection, player and buyer secrets',async t=>{
 const f=await fixture(t),p=await f.openStore(),path='/platform/workspaces/w/support';assert.equal((await f.request(path)).status,403);await f.db.prepare("INSERT INTO platform_admins VALUES('owner',1)").run();
 const server=await f.service.addServer('w',{name:'Support world',game:'asa',map:'Island',host:'8.8.8.8',port:27020,password:'SUPPORT-CONNECTION-SECRET'});await f.db.prepare("UPDATE servers SET status='offline',players=4,last_checked=1,player_list='[\"PRIVATE-PLAYER\"]',notes='PRIVATE-NOTES' WHERE id=?").run(server.id);await f.db.prepare('INSERT INTO incidents(id,workspace_id,server_id,opened_at) VALUES(?,?,?,?)').run(randomUUID(),'w',server.id,1);
 const recipient='0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',checkout=await f.store.checkout(f.site.slug,{id:'buyer'},{product_id:p.id,identifier:recipient,request_id:randomUUID()});await f.db.prepare("UPDATE store_orders SET payment_status='paid',fulfillment_status='pending' WHERE id=?").run(checkout.order_id);await f.db.prepare("INSERT INTO store_delivery_jobs(id,workspace_id,order_id,position,type,payload,status,created_at,updated_at) VALUES(?,'w',?,0,'rcon',?,'uncertain',1,1)").run(randomUUID(),checkout.order_id,JSON.stringify({command_template:'PRIVATE-DELIVERY-COMMAND'}));
 const result=await f.request(path);assert.equal(result.status,200);assert.equal(result.body.incidents.open,1);assert.equal(result.body.servers[0].last_checked,1);assert.equal(result.body.servers[0].status,'offline');assert.equal(result.body.delivery[0].status,'uncertain');assert.equal(result.body.orders[0].count,1);for(const secret of ['8.8.8.8','SUPPORT-CONNECTION-SECRET','PRIVATE-PLAYER','PRIVATE-NOTES','PRIVATE-DELIVERY-COMMAND',recipient,'private-token','acct_fixture'])assert.ok(!JSON.stringify(result.body).includes(secret));assert.equal(f.commands.length,0);assert.equal(f.awards.length,0);
 assert.equal((await f.request('/platform/workspaces/missing/support')).status,404);await f.db.prepare("UPDATE workspaces SET closed_at=1 WHERE id='w'").run();assert.equal((await f.request(path)).status,404);
});

test('platform community edits load separate application settings and preserve the community logo',async t=>{
 const f=await fixture(t);await f.db.prepare("INSERT INTO platform_admins VALUES('owner',1)").run();
 await f.community.saveSite('w',{...f.site,logo_url:'https://example.com/community.png',join_requests_open:false,staff_applications_open:true});
 const overview=await f.request('/platform'),site=overview.body.workspaces.find(w=>w.id==='w').site;assert.equal(overview.status,200);assert.equal(site.join_requests_open,0);assert.equal(site.staff_applications_open,1);
 const result=await f.request('/platform/workspaces/w/community','PUT',{...f.site,join_requests_open:false,staff_applications_open:true});assert.equal(result.status,200);assert.equal((await f.db.prepare("SELECT logo_url FROM community_sites WHERE workspace_id='w'").get()).logo_url,'https://example.com/community.png');assert.equal((await f.request('/platform')).body.activity[0].action,'Community page updated');
});

test('staff-delivered ASA checkout requires EOS and ASE checkout requires Steam64, including saved accounts',async t=>{
 const f=await fixture(t),p=await f.openStore(),eos='0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',steam='76561198000000000',buyer={id:'buyer'};
 assert.equal((await f.store.publicPage(f.site.slug,buyer)).products[0].delivery.identifier_kind,'eos');
 await assert.rejects(f.store.checkout(f.site.slug,buyer,{product_id:p.id,identifier:steam,request_id:randomUUID()}),/valid EOS ID/);
 await f.store.checkout(f.site.slug,buyer,{product_id:p.id,identifier:eos,request_id:randomUUID()});
 const id=randomUUID();await f.db.prepare('INSERT INTO community_game_accounts(id,workspace_id,user_id,game,identifier,label,created_at) VALUES(?,?,?,?,?,?,?)').run(id,'w','buyer','asa',steam,'Legacy incorrect ID',Date.now());
 await assert.rejects(f.store.checkout(f.site.slug,buyer,{product_id:p.id,account_id:id,request_id:randomUUID()}),/valid EOS ID/);
 await f.store.product('w',null,{title:'Evolved supplies',description:'An ASE starter kit for players.',game:'ase',price:500,published:true});const ase=(await f.store.manage('w')).products.find(v=>v.game==='ase');
 assert.equal((await f.store.publicPage(f.site.slug,buyer)).products.find(v=>v.id===ase.id).delivery.identifier_kind,'steam');
 await assert.rejects(f.store.checkout(f.site.slug,buyer,{product_id:ase.id,identifier:eos,request_id:randomUUID()}),/valid Steam64 ID/);
 const order=await f.store.checkout(f.site.slug,buyer,{product_id:ase.id,identifier:steam,request_id:randomUUID()});assert.equal((await f.db.prepare('SELECT identifier FROM store_orders WHERE id=?').get(order.order_id)).identifier,steam);
});

test('purchase actions reject the other game account type and retain explicit numeric PlayerID command support',async t=>{
 const f=await fixture(t),p=await f.openStore(),server=await f.service.addServer('w',{name:'ASA delivery',game:'asa',map:'Island',host:'8.8.8.8',port:27020,password:'fixture'}),path='/community/store/products/'+p.id+'/actions',base={type:'rcon',server_id:server.id,command_template:'GiveKit {identifier}',identity_kind:'steam'};
 assert.equal((await f.request(path,'PUT',{actions:[base],confirmation:p.title})).status,400);
 assert.equal((await f.request(path,'PUT',{actions:[{...base,identity_kind:'eos'}],confirmation:p.title})).status,200);
 assert.equal((await f.store.publicPage(f.site.slug,{id:'buyer'})).products[0].delivery.identifier_kind,'eos');
 assert.equal((await f.request(path,'PUT',{actions:[{...base,identity_kind:'numeric',command_template:'GiveExpToPlayer {identifier} 10 0 0'}],confirmation:p.title})).status,200);
 assert.equal((await f.store.publicPage(f.site.slug,{id:'buyer'})).products[0].delivery.identifier_kind,'numeric');
});

test('package bundles copy same-game contents into a new draft and keep order snapshots independent of source edits',async t=>{
 const f=await fixture(t),first=await f.openStore();await f.store.product('w',null,{title:'Building supplies',description:'A package of building supplies delivered by staff.',game:'asa',price:750,published:true});const second=(await f.store.manage('w')).products.find(p=>p.id!==first.id),input={title:'Explorer bundle',description:'Two supply packages delivered together by staff.',price:1000,source_ids:[first.id,second.id],automatic:false,confirmation:'Explorer bundle'};
 assert.equal((await f.request('/community/store/bundles','POST',input,'admin')).status,403);assert.equal((await f.request('/community/store/bundles','POST',input,'owner',false)).status,403);
 assert.equal((await f.request('/community/store/bundles','POST',{...input,confirmation:'wrong'})).status,400);assert.equal((await f.request('/community/store/bundles','POST',{...input,source_ids:[first.id,first.id]})).status,400);
 const created=await f.request('/community/store/bundles','POST',input);assert.equal(created.status,201);const bundle=created.body.products.find(p=>p.id===created.body.saved_product_id);assert.equal(bundle.published,0);assert.equal(JSON.parse(bundle.bundle_contents).length,2);assert.equal(JSON.parse(bundle.delivery_actions).length,0);
 await f.store.product('w',bundle.id,{title:bundle.title,description:bundle.description,price:bundle.price,game:'asa',published:true});const result=await f.store.checkout('test-community',{id:'buyer'},{product_id:bundle.id,identifier:'0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',request_id:randomUUID()});let order=await f.db.prepare('SELECT * FROM store_orders WHERE id=?').get(result.order_id);assert.equal(JSON.parse(order.bundle_contents)[0].title,'Starter kit');assert.equal(order.amount,1000);
 await f.store.product('w',first.id,{title:'Changed source',description:'The source package now has different contents.',game:'asa',price:999,published:false});await f.store.archive('w',second.id);assert.equal(JSON.parse((await f.db.prepare('SELECT bundle_contents FROM store_products WHERE id=?').get(bundle.id)).bundle_contents)[0].title,'Starter kit');assert.equal((await f.store.buyerOrders('test-community',{id:'buyer'}))[0].bundle_contents[1].title,'Building supplies');
});

test('automatic bundles require compatible, bounded, owner-authorised purchase actions and drafts duplicate without actions',async t=>{
 const f=await fixture(t),a=await f.openStore();await f.store.product('w',null,{title:'Second package',description:'A second kit delivered with the first package.',game:'asa',price:500,published:true});const b=(await f.store.manage('w')).products.find(p=>p.id!==a.id),input={title:'Combined automatic kit',description:'Two configured kits delivered as a single package.',price:800,source_ids:[a.id,b.id],automatic:true,confirmation:'Combined automatic kit'};
 await assert.rejects(f.store.bundle('w',input),/Every source package/);f.store.setActionsValidator(async(_,__,actions)=>actions);const action={type:'rcon',server_id:randomUUID(),command_template:'GiveKit {identifier}',identity_kind:'game',target_fingerprint:'fixture',label:'Test world'};for(const p of[a,b])await f.db.prepare('UPDATE store_products SET delivery_actions=? WHERE id=?').run(JSON.stringify([action]),p.id);
 const result=await f.store.bundle('w',input),bundle=result.products.find(p=>p.id===result.saved_product_id);assert.equal(JSON.parse(bundle.delivery_actions).length,2);
 const copy=await f.request('/community/store/products/'+bundle.id+'/duplicate','POST',{},'admin');assert.equal(copy.status,201);const cloned=copy.body.products.find(p=>p.id===copy.body.saved_product_id);assert.equal(cloned.title,'Copy of Combined automatic kit');assert.equal(cloned.published,0);assert.equal(cloned.delivery_actions,'[]');assert.equal(cloned.bundle_contents,bundle.bundle_contents);
 await f.db.prepare("UPDATE store_products SET game='ase' WHERE id=?").run(b.id);await assert.rejects(f.store.bundle('w',input),/same game/);
});

test('Discord shop and order commands are guild-bound and ephemeral without widening admin command permissions',async t=>{
 const f=await fixture(t),p=await f.openStore(),guild='223456789012345678',discord='323456789012345678';await f.db.prepare('UPDATE workspaces SET guild_id=? WHERE id=?').run(guild,'w');await f.db.prepare("UPDATE users SET discord_id=? WHERE id='buyer'").run(discord);const pending=await f.store.checkout('test-community',{id:'buyer'},{product_id:p.id,identifier:'0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',request_id:randomUUID()});
 const calls=[],interaction={commandName:'shop',guildId:guild,user:{id:discord},deferred:false,inGuild:()=>true,isAutocomplete:()=>false,deferReply:async value=>{calls.push({defer:value});interaction.deferred=true;},editReply:async value=>calls.push(value),reply:async value=>calls.push(value)};
 assert.equal(await handleStoreInteraction(f.db,f.store,interaction,{APP_URL:'https://rookrift.example'}),true);assert.equal(calls[0].defer.flags,MessageFlags.Ephemeral);let message=calls.at(-1);assert.ok(message.embeds[0].toJSON().description.includes('Starter kit'));assert.equal(message.components[0].toJSON().components[0].url,'https://rookrift.example/c/test-community?page=store');assert.deepEqual(message.allowedMentions,{parse:[]});
 calls.length=0;interaction.commandName='orders';interaction.deferred=false;await handleStoreInteraction(f.db,f.store,interaction,{APP_URL:'https://rookrift.example'});assert.ok(calls.at(-1).embeds[0].toJSON().description.includes(pending.order_id));assert.ok(!JSON.stringify(calls.at(-1)).includes('0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
 interaction.user.id='423456789012345678';calls.length=0;await handleStoreInteraction(f.db,f.store,interaction,{APP_URL:'https://rookrift.example'});assert.ok(calls.at(-1).content.includes('link this Discord account'));assert.ok(!JSON.stringify(calls).includes(pending.order_id));
 const definitions=commandDefinitions();assert.equal(definitions.find(c=>c.name==='rookrift').default_member_permissions,String(PermissionFlagsBits.ManageGuild));for(const name of['shop','orders']){const command=definitions.find(c=>c.name===name);assert.deepEqual(command.contexts,[0]);assert.ok(!command.default_member_permissions);}
});

test('command registration can use encrypted admin configuration while environment values take priority',async t=>{
 const f=await fixture(t);for(const[key,value]of [['discord_client_id','123456789012345678'],['discord_bot_token','fixture-bot-secret']])await f.db.prepare('INSERT INTO platform_settings VALUES(?,?,?)').run(key,f.vault.encrypt(value),Date.now());
 const saved=await discordRegistrationConfig(f.db,f.vault,{});assert.equal(saved.clientId,'123456789012345678');assert.equal(saved.botToken,'fixture-bot-secret');
 const mixed=await discordRegistrationConfig(f.db,f.vault,{DISCORD_CLIENT_ID:'223456789012345678',DISCORD_DEV_GUILD_ID:'323456789012345678'});assert.equal(mixed.clientId,'223456789012345678');assert.equal(mixed.botToken,'fixture-bot-secret');assert.equal(mixed.guildId,'323456789012345678');
});

test('store promotions validate scope, roles, CSRF and unique codes without exposing codes publicly',async t=>{
 const f=await fixture(t),p=await f.openStore(),path='/community/store/promotions';
 for(const who of ['mod','scoped'])assert.equal((await f.request(path,'POST',promotionInput(),who)).status,403);
 assert.equal((await f.request(path,'POST',promotionInput(),'owner',false)).status,403);
 assert.equal((await f.request(path,'POST',promotionInput({discount_value:96}))).status,400);
 assert.equal((await f.request(path,'POST',promotionInput({product_ids:[randomUUID()]}))).status,404);
 assert.equal((await f.request(path,'POST',promotionInput({code:' welcome10 '}),'admin')).status,201);
 assert.equal((await f.request(path,'POST',promotionInput())).status,409);
 const page=(await f.request('/public/communities/test-community/store','GET',null,null)).body;assert.ok(!JSON.stringify(page).includes('WELCOME10'));
 const promo=(await f.store.growth.list('w')).promotions[0];assert.equal(promo.code,'WELCOME10');assert.equal((await f.request(path+'/'+promo.id,'PATCH',promotionInput({code:'DIFFERENT'}))).status,400);
 await f.store.growth.archivePromotion('w',promo.id);assert.equal((await f.store.growth.list('w')).promotions.length,0);assert.equal((await f.request(path,'POST',promotionInput())).status,409);
});

test('coupon prices are snapshotted, bounded, not stacked with sales and never trusted from the browser',async t=>{
 const f=await fixture(t),p=await f.openStore(),base='/public/communities/test-community/store';
 await f.store.growth.savePromotion('w',null,promotionInput({kind:'sale',code:'',name:'Weekend sale',discount_value:20}));
 assert.equal((await f.store.publicPage('test-community',null)).products[0].price,400);
 assert.equal((await f.store.publicPage('test-community',null)).products[0].base_price,500);
 await f.store.growth.savePromotion('w',null,promotionInput({discount_type:'fixed',discount_value:1000}));
 const quote=await f.request(base+'/quote','POST',{product_id:p.id,code:' welcome10 '},'buyer');assert.equal(quote.status,200);assert.equal(quote.body.amount,50);assert.equal(quote.body.discount_amount,450);
 assert.equal((await f.request(base+'/quote','POST',{product_id:p.id,code:'WELCOME10',amount:1},'buyer')).status,400);
 const body={product_id:p.id,identifier:'0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',request_id:randomUUID(),code:'WELCOME10'};assert.equal((await f.request(base+'/checkout','POST',body,'buyer')).status,200);
 const order=await f.db.prepare('SELECT * FROM store_orders WHERE id=?').get(body.request_id);assert.equal(order.amount,50);assert.equal(order.base_amount,500);assert.equal(order.discount_amount,450);assert.equal(f.sessions.get(order.checkout_session_id).amount_total,50);
 for(const promo of (await f.store.growth.list('w')).promotions)await f.store.growth.archivePromotion('w',promo.id);
 assert.equal((await f.request(base+'/checkout','POST',body,'buyer')).status,200);assert.equal(f.creates,1);
 assert.equal((await f.request(base+'/checkout','POST',{...body,code:''},'buyer')).status,409);
});

test('concurrent reservations cannot oversell stock or coupon limits, and confirmed cancellation releases a slot',async t=>{
 const f=await fixture(t),p=await f.openStore(),base='/public/communities/test-community/store';await f.store.growth.saveAvailability('w',p.id,availabilityInput({stock_limit:1}));await f.store.growth.savePromotion('w',null,promotionInput({usage_limit:1}));
 const bodies=['buyer','other'].map(who=>({who,body:{product_id:p.id,identifier:'0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',request_id:randomUUID(),code:'WELCOME10'}})),results=await Promise.all(bodies.map(({who,body})=>f.request(base+'/checkout','POST',body,who)));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const index=results.findIndex(r=>r.status===200),winner=bodies[index];assert.equal((await f.request(base+'/checkout','POST',winner.body,winner.who)).status,200);
 assert.equal((await f.request(base+'/orders/'+winner.body.request_id+'/cancel','POST',{},bodies[1-index].who)).status,404);
 assert.equal((await f.request(base+'/orders/'+winner.body.request_id+'/cancel','POST',{},winner.who)).body.payment_status,'expired');
 assert.equal((await f.request(base+'/checkout','POST',bodies[1-index].body,bodies[1-index].who)).status,200);
});

test('customer and schedule limits apply to free claims and free actions are durably enqueued without Stripe',async t=>{
 const f=await fixture(t),p=await f.openStore(),base='/public/communities/test-community/store';
 await f.store.product('w',p.id,{title:p.title,description:p.description,game:p.game,price:0,published:true});await f.store.growth.saveAvailability('w',p.id,availabilityInput({customer_limit:1}));
 await f.db.prepare("UPDATE store_products SET delivery_actions=? WHERE id=?").run(JSON.stringify([{type:'discord_role',guild_id:'123456789012345678',role_id:'223456789012345670'}]),p.id);
 await f.db.prepare("UPDATE workspaces SET guild_id='123456789012345678' WHERE id='w'").run();
 // Keep validation focused on reservation/queue behaviour, with the reward
 // adapter already covered by the dedicated purchase delivery tests.
 f.store.setActionsValidator(async(_,__,actions)=>actions);
 const body={product_id:p.id,identifier:'0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',request_id:randomUUID()};const result=await f.request(base+'/checkout','POST',body,'123456789012345678');assert.equal(result.status,200);assert.equal(result.body.free,true);assert.equal(f.creates,0);
 const job=await f.db.prepare('SELECT * FROM store_delivery_jobs WHERE order_id=?').get(body.request_id);assert.equal(job.status,'pending');assert.equal((await f.request(base+'/checkout','POST',body,'123456789012345678')).status,200);
 assert.equal((await f.request(base+'/checkout','POST',{...body,request_id:randomUUID()},'123456789012345678')).status,409);
 await f.db.prepare("UPDATE store_products SET delivery_actions='[]' WHERE id=?").run(p.id);
 const unconfigured=createCommunityStore(f.db,{APP_URL:'http://localhost:3000'}),claim=await unconfigured.checkout('test-community',{id:'other'},{product_id:p.id,identifier:'0002bbbbbbbbbbbbbbbbbbbbbbbbbbbb',request_id:randomUUID()});assert.equal(unconfigured.ready,false);assert.equal(claim.free,true);
 assert.equal((await unconfigured.fulfill('w',claim.order_id,{note:'Free claim delivered by staff.'},{id:'owner',name:'Owner'})).fulfillment_status,'fulfilled');
 await f.store.growth.saveAvailability('w',p.id,availabilityInput({available_from:Date.now()+600000}));assert.equal((await f.store.publicPage('test-community',null)).products[0].availability.available,false);
 assert.equal((await f.request(base+'/checkout','POST',{...body,request_id:randomUUID()},'123456789012345678')).status,409);
});

test('unknown checkout responses keep their reservation and cannot be cancelled as if no payment existed',async t=>{
 const f=await fixture(t),p=await f.openStore(),body={product_id:p.id,identifier:'0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',request_id:randomUUID()};await f.store.growth.saveAvailability('w',p.id,availabilityInput({stock_limit:1}));f.loseResponse();
 assert.equal((await f.request('/public/communities/test-community/store/checkout','POST',body,'buyer')).status,502);
 assert.equal((await f.request('/public/communities/test-community/store/orders/'+body.request_id+'/cancel','POST',{},'buyer')).status,409);
 assert.equal((await f.store.publicPage('test-community',null)).products[0].availability.remaining,0);
 assert.equal((await f.request('/public/communities/test-community/store/checkout','POST',body,'buyer')).status,200);
});

test('sales analytics and opt-in goals count verified paid purchases and exclude refunds, disputes and free claims',async t=>{
 const f=await fixture(t),p=await f.openStore(),body={product_id:p.id,identifier:'0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',request_id:randomUUID()};await f.store.checkout('test-community',{id:'buyer'},body);let order=await f.db.prepare('SELECT * FROM store_orders WHERE id=?').get(body.request_id);
 await f.store.growth.saveGoal('w',{goal_enabled:true,goal_amount:10000,goal_title:'Keep our worlds running'});assert.equal((await f.store.publicPage('test-community',null)).goal.raised,0);
 f.pay(order.checkout_session_id);await f.store.refreshBuyerOrder('test-community',{id:'buyer'},order.id);
 const analytics=await f.store.growth.analytics('w',7);assert.equal(analytics.orders,1);assert.equal(analytics.amount,500);assert.equal(analytics.series.length,7);assert.equal(analytics.products[0].title,p.title);assert.equal((await f.store.publicPage('test-community',null)).goal.raised,500);
 const session=f.sessions.get(order.checkout_session_id);session.payment_intent.latest_charge.amount_refunded=250;await f.store.refreshBuyerOrder('test-community',{id:'buyer'},order.id);assert.equal((await f.store.growth.analytics('w',7)).amount,0);assert.equal((await f.store.publicPage('test-community',null)).goal.raised,0);
 assert.equal((await f.request('/community/store/analytics?days=7','GET',null,'mod')).status,403);assert.equal((await f.request('/community/store/analytics?days=8')).status,400);
 await f.store.growth.saveGoal('w',{goal_enabled:false,goal_amount:10000,goal_title:'Keep our worlds running'});assert.equal((await f.store.publicPage('test-community',null)).goal,null);
});

test('coupon quotas are independent of stock and displayed-price changes require a fresh review',async t=>{
 const f=await fixture(t),p=await f.openStore(),base='/public/communities/test-community/store';await f.store.growth.savePromotion('w',null,promotionInput({usage_limit:1}));
 const results=await Promise.all(['buyer','other'].map(who=>f.request(base+'/checkout','POST',{product_id:p.id,identifier:who==='buyer'?'0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa':'0002bbbbbbbbbbbbbbbbbbbbbbbbbbbb',request_id:randomUUID(),code:'WELCOME10',expected_amount:450,expected_currency:'gbp'},who)));
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===400).length,1);assert.equal((await f.store.growth.list('w')).promotions[0].used,1);
 const unchanged={product_id:p.id,identifier:'0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',request_id:randomUUID(),expected_amount:499,expected_currency:'gbp'};assert.equal((await f.request(base+'/checkout','POST',unchanged,'buyer')).status,409);assert.equal(await f.db.prepare('SELECT id FROM store_orders WHERE id=?').get(unchanged.request_id),undefined);
 await f.store.settings('w',{...f.settings,payment_provider:'tebex',payment_checkout_url:'https://example.com/checkout/{order_id}'});assert.equal((await f.store.publicPage('test-community',{id:'buyer'})).products[0].price,500);assert.equal((await f.request(base+'/quote','POST',{product_id:p.id,code:'WELCOME10'},'buyer')).status,400);
});

test('join requests and staff applications close independently and retain their separate review queues',async t=>{
 const f=await fixture(t),base='/public/communities/test-community',page=(await f.request(base)).body;
 const input={kind:'staff',game:'asa',identifier:'EOS-TEST',form_revision:page.site.form_revision,rules_accepted:true,answers:['I can help.']};
 assert.equal((await f.request(base+'/applications','POST',input,'buyer')).status,409);
 assert.equal((await f.request(base+'/applications','POST',{...input,kind:'join'},'buyer')).status,201);
 await f.community.saveSite('w',{...f.site,join_requests_open:false,staff_applications_open:true});const next=(await f.request(base)).body;
 assert.equal(next.site.join_requests_open,false);assert.deepEqual(next.site.join_questions,[]);assert.deepEqual(next.site.staff_questions,['What can you offer the team?']);
 assert.equal((await f.request(base+'/applications','POST',{...input,form_revision:next.site.form_revision},'buyer')).status,201);
 assert.equal((await f.request('/community/applications?kind=join')).body.length,1);assert.equal((await f.request('/community/applications?kind=staff')).body.length,1);
 await f.community.saveSite('w',{...f.site,join_requests_open:false,staff_applications_open:false});assert.equal((await f.request(base)).body.site.applications_open,false);assert.equal((await f.request('/community/applications')).body.length,2);
});
test('site drafts remain private, publish atomically, reset from publication, and enforce staff access and safe URLs',async t=>{
 const f=await fixture(t),draft=structuredClone(DEFAULT_DESIGN);draft.pages[0].blocks[0].body='PRIVATE DRAFT';
 assert.equal((await f.request('/community/site-builder','PUT',draft,'mod')).status,403);assert.equal((await f.request('/community/site-builder','PUT',draft,'scoped')).status,403);
 assert.equal((await f.request('/community/site-builder','PUT',draft,'admin')).status,200);assert.equal((await f.request('/public/communities/test-community')).body.site.design,null);
 assert.equal((await f.request('/community/site-builder/publish','POST',{})).status,200);assert.equal((await f.request('/public/communities/test-community')).body.site.design.pages[0].blocks[0].body,'PRIVATE DRAFT');
 draft.pages[0].blocks[0].body='UNPUBLISHED EDIT';await f.request('/community/site-builder','PUT',draft);assert.ok(!JSON.stringify((await f.request('/public/communities/test-community')).body).includes('UNPUBLISHED EDIT'));
 await f.request('/community/site-builder/reset','POST',{});assert.equal((await f.request('/community/site-builder')).body.draft.pages[0].blocks[0].body,'PRIVATE DRAFT');
 draft.pages[0].blocks[0].link_url='javascript:alert(1)';draft.pages[0].blocks[0].link_label='Unsafe';assert.equal((await f.request('/community/site-builder','PUT',draft)).status,400);
});
test('store checkout uses server prices, stable reservations and merchant context; payment and delivery are independently verified',async t=>{
 const f=await fixture(t),p=await f.openStore(),body={product_id:p.id,identifier:'0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',request_id:randomUUID()},base='/public/communities/test-community/store';
 assert.equal((await f.request(base+'/checkout','POST',body,null)).status,401);assert.equal((await f.request(base+'/checkout','POST',body,'buyer',false)).status,403);
 assert.equal((await f.request(base+'/checkout','POST',{...body,amount:1},'buyer')).status,400);
 const results=await Promise.all([f.request(base+'/checkout','POST',body,'buyer'),f.request(base+'/checkout','POST',body,'buyer')]);assert.ok(results.every(r=>r.status===200));assert.equal(f.creates,1);
 const order=await f.db.prepare('SELECT * FROM store_orders WHERE id=?').get(body.request_id);assert.equal(order.amount,500);assert.equal(order.fulfillment_status,'awaiting_payment');
 assert.equal((await f.request('/community/store/orders/'+order.id+'/fulfill','POST',{note:'Delivered by staff.'})).status,409);
 assert.equal((await f.request(base+'/orders/'+order.id+'/refresh','POST',{},'other')).status,404);
 const session=f.pay(order.checkout_session_id);assert.equal(await f.event(session),200);await f.store.verifyForDelivery('w',order.id);assert.deepEqual(f.mailed,[order.id]);assert.equal((await f.store.manage('w')).orders[0].fulfillment_status,'pending');
 const deliveries=await Promise.all([f.store.fulfill('w',order.id,{note:'Delivered at the community hub.'},{id:'owner',name:'Owner'}),f.store.fulfill('w',order.id,{note:'Second attempt.'},{id:'owner',name:'Owner'})].map(p=>p.then(()=>200,e=>e.status)));assert.deepEqual(deliveries.sort(),[200,409]);
 assert.equal((await f.request(base+'/orders','GET',null,'other')).body.length,0);const own=(await f.request(base+'/orders','GET',null,'buyer')).body[0];assert.equal(own.fulfillment_status,'fulfilled');assert.ok(!JSON.stringify(own).includes('acct_fixture'));assert.ok(!JSON.stringify(own).includes('stripe_account'));
 await f.store.product('w',p.id,{title:'Edited kit',description:'Different contents after purchase.',price:999,game:'ase',published:false});await f.store.settings('w',{...f.settings,enabled:false,delivery_note:'New delivery terms for future orders.'});await f.store.archive('w',p.id);
 const retained=(await f.store.buyerOrders('test-community',{id:'buyer'}))[0];assert.equal(retained.title,'Starter kit');assert.equal(retained.amount,500);assert.equal(retained.delivery_note,f.settings.delivery_note);
 assert.equal((await f.request(base)).status,404);assert.equal((await f.request(base+'/orders','GET',null,'buyer')).body.length,1);
});
test('signed Connect webhooks recover uncertain checkouts and reject price/account mismatches; refunds require review',async t=>{
 const f=await fixture(t),p=await f.openStore(),input={product_id:p.id,identifier:'0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',request_id:randomUUID()};f.loseResponse();await assert.rejects(f.store.checkout('test-community',{id:'buyer'},input),/Stripe is unavailable/);
 assert.equal((await f.request('/webhooks/community-stripe','POST',{id:'forged'})).status,400);
 let row=await f.db.prepare('SELECT * FROM store_orders WHERE id=?').get(input.request_id);assert.equal(row.checkout_session_id,null);
 const session=f.pay([...f.sessions.keys()][0]);assert.equal(await f.event(session,'checkout.session.completed','acct_wrong'),200);assert.equal((await f.store.manage('w')).orders[0].payment_status,'pending');
 const validAmount=session.amount_total;session.amount_total=1;assert.equal(await f.event(session),409);row=await f.db.prepare('SELECT * FROM store_orders WHERE id=?').get(input.request_id);assert.equal(row.checkout_session_id,null);session.amount_total=validAmount;
 const eventId=randomUUID();assert.equal(await f.event(session,'checkout.session.completed','acct_fixture',eventId),200);assert.equal(await f.event(session,'checkout.session.completed','acct_fixture',eventId),200);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM store_stripe_events WHERE id=?').get(eventId)).n,1);
 session.payment_intent.latest_charge.amount_refunded=500;assert.equal(await f.event({payment_intent:session.payment_intent.id},'charge.refunded'),200);row=await f.db.prepare('SELECT * FROM store_orders WHERE id=?').get(input.request_id);assert.equal(row.payment_status,'refunded');assert.equal(row.fulfillment_status,'review_required');await assert.rejects(f.store.fulfill('w',row.id,{note:'Do not deliver.'},{id:'owner',name:'Owner'}),/completed payment/);
 assert.equal((await f.request('/community/store/connect','POST',{},'admin')).status,403);assert.equal((await f.request('/community/store','GET',null,'mod')).status,403);
});
test('Nitrado capability guards reject backup jobs and configuration access before sending a provider request',async t=>{
 const f=await fixture(t),server=await f.service.addServer('w',{name:'Nitrado world',game:'asa',map:'Island',host:'8.8.8.8',port:27020,password:'private'});
 await f.db.prepare("INSERT INTO hosting_connections VALUES(?,'w','nitrado','https://api.nitrado.net','12345',?,1)").run(server.id,f.vault.encrypt('private-provider-token'));
 await assert.rejects(f.service.addSchedule('w',{name:'Unsupported archive',server_id:server.id,action:'backup',interval_minutes:60}),/does not support/);
 assert.equal((await f.request('/servers/'+server.id+'/hosting/actions','POST',{action:'backup',confirmation:server.name})).status,400);
 assert.equal((await f.request('/workflows','POST',{name:'Unsupported archive',server_id:server.id,steps:[{type:'backup'}],enabled:true,trigger_type:'manual',cooldown_minutes:10,days:[1],start_time:'04:00',time_zone:'Europe/London',interval_minutes:60})).status,400);
});
test('platform Connect settings are root-only, encrypted, masked and independent from subscription billing',async t=>{
 const f=await fixture(t);assert.equal((await f.request('/platform/settings','PATCH',{stripe_connect_secret_key:'sk_test_private'})).status,403);
 await f.db.prepare("INSERT INTO platform_admins VALUES('owner',1)").run();const update=await f.request('/platform/settings','PATCH',{stripe_connect_secret_key:'sk_test_private',stripe_connect_webhook_secret:'whsec_private'});assert.equal(update.status,200);assert.equal(update.body.restart_required,true);
 const row=await f.db.prepare("SELECT value FROM platform_settings WHERE key='stripe_connect_secret_key'").get();assert.ok(!row.value.includes('sk_test_private'));assert.equal(f.vault.decrypt(row.value),'sk_test_private');const state=(await f.request('/platform')).body;assert.equal(state.settings.stripe_connect_secret_key.configured,true);assert.equal(state.settings.stripe_secret_key.configured,false);assert.ok(!JSON.stringify(state).includes('whsec_private'));
});
test('accounts create and switch between isolated workspaces with independent subscriptions and public pages',async t=>{
 const f=await fixture(t);assert.equal((await f.request('/workspaces','POST',{name:'ASE worlds',game_focus:'ase'},null)).status,401);
 const created=await f.request('/workspaces','POST',{name:'ASE worlds',game_focus:'ase'});assert.equal(created.status,201);const bootstrap=(await f.request('/bootstrap')).body;assert.equal(bootstrap.workspace.id,created.body.id);assert.equal(bootstrap.workspace.plan,'scout');assert.equal(bootstrap.workspace.game_focus,'ase');assert.equal(bootstrap.servers.length,0);assert.equal((await f.request('/community')).body.site,null);assert.equal((await f.request('/community/store')).body.products.length,0);
 await assert.rejects(f.service.addServer(created.body.id,{name:'Wrong game',game:'asa',map:'Island',host:'8.8.8.8',port:27020,password:'fixture'}),/game focus/);
 assert.equal((await f.request('/workspaces','POST',{name:'ase worlds',game_focus:'asa'})).status,409);await f.request('/workspaces/switch','POST',{workspace_id:'w'});assert.equal((await f.request('/bootstrap')).body.workspace.plan,'cluster');assert.equal((await f.request('/community')).body.site.slug,'test-community');assert.equal(await ensurePersonalWorkspace(f.db,'owner'),'w');assert.equal((await f.request('/workspaces','GET',null,'other')).body.some(w=>w.id===created.body.id),false);
});
test('workspace creation serializes per-account quotas and rejects guessed foreign targets',async t=>{
 const f=await fixture(t),r=await Promise.all(Array.from({length:12},(_,i)=>f.request('/workspaces','POST',{name:'Cluster '+i,game_focus:'mixed'})));assert.equal(r.filter(r=>r.status===201).length,9);assert.equal(r.filter(r=>r.status===403).length,3);assert.equal((await f.db.prepare("SELECT count(*) AS n FROM workspaces WHERE owner_id='owner'").get()).n,10);assert.equal((await f.request('/workspaces/switch','POST',{workspace_id:randomUUID()})).status,404);
});
test('store categories and HTTPS images are scoped, public only with visible products and retained in purchase snapshots',async t=>{
 const f=await fixture(t),p=await f.openStore();await f.store.category('w',null,{name:'Building kits',sort_order:3});const category=(await f.store.manage('w')).categories[0];await f.store.product('w',p.id,{title:p.title,description:p.description,price:500,game:'asa',published:true,image_url:'https://example.com/kit.webp',category_id:category.id,sort_order:2});
 const page=await f.store.publicPage(f.site.slug,{id:'buyer'});assert.equal(page.products[0].image_url,'https://example.com/kit.webp');assert.equal(page.categories[0].name,'Building kits');await assert.rejects(f.store.product('w',p.id,{title:p.title,description:p.description,price:500,game:'asa',published:true,image_url:'javascript:alert(1)'}));await assert.rejects(f.store.product('w',p.id,{title:p.title,description:p.description,price:500,game:'asa',published:true,category_id:randomUUID()}),/category/);
 const orderId=randomUUID();await f.store.checkout(f.site.slug,{id:'buyer'},{product_id:p.id,identifier:'0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',request_id:orderId});await f.store.removeCategory('w',category.id);const order=(await f.store.buyerOrders(f.site.slug,{id:'buyer'}))[0];assert.equal(order.category_name,'Building kits');assert.equal(order.image_url,'https://example.com/kit.webp');assert.equal((await f.store.manage('w')).products[0].category_id,null);
});
async function automatedFixture(t,options={}){
 const f=await fixture(t,options),p=await f.openStore(),server=await f.service.addServer('w',{name:'Delivery world',game:'asa',map:'Island',host:'8.8.8.8',port:27020,password:'fixture'});await f.db.prepare("UPDATE servers SET status='online',last_checked=? WHERE id=?").run(Date.now(),server.id);await f.db.prepare("UPDATE workspaces SET guild_id='323456789012345678' WHERE id='w'").run();
 const command={type:'rcon',server_id:server.id,identity_kind:'numeric',command_template:'GiveItemToPlayer {identifier} "Blueprint\'Example\'" 1 0 0'},role={type:'discord_role',role_id:'223456789012345670'};
 await f.store.configureActions('w',p.id,{actions:[command,role],confirmation:p.title});return{...f,p,server,command,role};
}
async function paidAutomation(f){const id=randomUUID();await f.store.checkout(f.site.slug,{id:'123456789012345678'},{product_id:f.p.id,identifier:'123456',request_id:id});const session=f.pay('cs_'+id);assert.equal(await f.event(session),200);return{id,session};}
test('verified purchases create one durable action sequence and award the authenticated buyer in the bound guild',async t=>{
 const f=await automatedFixture(t),{id,session}=await paidAutomation(f);await f.event(session);assert.equal((await f.delivery.jobs('w',id)).length,2);await f.delivery.tick();await f.delivery.tick();assert.equal(f.commands.length,1);assert.equal(f.commands[0].command,'GiveItemToPlayer 123456 "Blueprint\'Example\'" 1 0 0');assert.equal(f.awards.length,1);assert.equal(f.awards[0].user,'123456789012345678');assert.equal(f.awards[0].guild,'323456789012345678');assert.equal((await f.store.buyerOrders(f.site.slug,{id:'123456789012345678'}))[0].fulfillment_status,'fulfilled');
 const publicPage=await f.store.publicPage(f.site.slug);assert.ok(!JSON.stringify(publicPage).includes('GiveItemToPlayer'));assert.equal(publicPage.products[0].delivery.identifier_kind,'numeric');assert.equal((await f.request('/community/store/products/'+f.p.id+'/actions','PUT',{actions:[],confirmation:f.p.title},'admin')).status,403);
});
test('uncertain RCON commands are never replayed by retries, reconciliation or worker recovery',async t=>{
 const f=await automatedFixture(t,{failCommand:true}),{id,session}=await paidAutomation(f);await f.delivery.tick();assert.equal((await f.delivery.jobs('w',id))[0].status,'uncertain');await f.delivery.retry('w',id);await f.delivery.recover();await f.event(session);await f.delivery.tick();assert.equal(f.commands.length,1);assert.equal(f.awards.length,0);
 const job=(await f.delivery.jobs('w',id))[0];await f.delivery.resolve('w',id,job.id,{status:'succeeded',note:'Verified the item was received in-game.'},{name:'Owner'});await f.delivery.tick();assert.equal(f.commands.length,1);assert.equal(f.awards.length,1);
});
test('refunds cancel unsent actions, and changed targets or mismatched identifier types cannot run commands',async t=>{
 const f=await automatedFixture(t),{id,session}=await paidAutomation(f);session.payment_intent.latest_charge.amount_refunded=500;await f.event({payment_intent:session.payment_intent.id},'charge.refunded');await f.delivery.tick();assert.equal(f.commands.length,0);assert.ok((await f.delivery.jobs('w',id)).every(j=>j.status==='cancelled'));
 await assert.rejects(f.store.checkout(f.site.slug,{id:'buyer'},{product_id:f.p.id,identifier:'123456',request_id:randomUUID()}),/Discord/);await assert.rejects(f.store.checkout(f.site.slug,{id:'123456789012345678'},{product_id:f.p.id,identifier:'EOS-ID',request_id:randomUUID()}),/numeric/i);
 const paid=await paidAutomation(f);await f.db.prepare("UPDATE servers SET host='8.8.4.4' WHERE id=?").run(f.server.id);await f.delivery.tick();assert.equal((await f.delivery.jobs('w',paid.id))[0].status,'blocked');assert.equal(f.commands.length,0);
});
test('command templates reject chaining and ARK account IDs cannot masquerade as numeric PlayerIDs',async t=>{
 const f=await automatedFixture(t);await assert.rejects(f.store.configureActions('w',f.p.id,{actions:[{...f.command,command_template:'GiveItemToPlayer {identifier} x 1 0 0; DestroyWildDinos'}],confirmation:f.p.title}),/one command/);await assert.rejects(f.store.configureActions('w',f.p.id,{actions:[{...f.command,identity_kind:'eos'}],confirmation:f.p.title}),/numeric in-game/);await assert.rejects(f.store.configureActions('w',f.p.id,{actions:[{...f.command,server_id:randomUUID()}],confirmation:f.p.title}),/Server not found/);
});

test('purchase delivery defers unsent commands offline and recovers interrupted actions without replay',async t=>{
 const f=await automatedFixture(t),{id}=await paidAutomation(f);
 await f.db.prepare("UPDATE servers SET status='offline' WHERE id=?").run(f.server.id);
 await f.delivery.tick();assert.equal(f.commands.length,0);assert.equal((await f.delivery.jobs('w',id))[0].status,'pending');
 await f.db.prepare("UPDATE store_delivery_jobs SET status='executing' WHERE order_id=?").run(id);
 await f.delivery.recover();const jobs=await f.delivery.jobs('w',id);assert.equal(jobs[0].status,'uncertain');assert.equal(jobs[1].status,'pending');
 await f.delivery.tick();assert.equal(f.commands.length,0);assert.equal(f.awards.length,0);assert.equal((await f.store.manage('w')).orders[0].fulfillment_status,'review_required');
});

test('role-only purchases omit the game identifier and preserve the order action snapshot',async t=>{
 const f=await automatedFixture(t);await f.store.configureActions('w',f.p.id,{actions:[f.role],confirmation:f.p.title});
 const id=randomUUID();await f.store.checkout(f.site.slug,{id:'123456789012345678'},{product_id:f.p.id,identifier:'',request_id:id});
 await f.store.configureActions('w',f.p.id,{actions:[],confirmation:f.p.title});
 await f.event(f.pay('cs_'+id));await f.delivery.tick();assert.equal(f.commands.length,0);assert.equal(f.awards.length,1);assert.equal((await f.store.buyerOrders(f.site.slug,{id:'123456789012345678'}))[0].fulfillment_status,'fulfilled');
});

test('a local buyer uses their stored OAuth-linked Discord recipient and cannot choose another role recipient',async t=>{
 const f=await automatedFixture(t);await f.store.configureActions('w',f.p.id,{actions:[f.role],confirmation:f.p.title});
 await f.db.prepare("UPDATE users SET discord_id='423456789012345678' WHERE id='buyer'").run();
 const page=await f.store.publicPage(f.site.slug,{id:'buyer'});assert.equal(page.discord_connected,true);
 const id=randomUUID();await f.store.checkout(f.site.slug,{id:'buyer',discord_id:'999999999999999999'},{product_id:f.p.id,identifier:'',request_id:id});
 await f.event(f.pay('cs_'+id));await f.delivery.tick();assert.equal(f.awards[0].user,'423456789012345678');
 const row=await f.db.prepare('SELECT discord_user_id FROM store_orders WHERE id=?').get(id);assert.equal(row.discord_user_id,'423456789012345678');
});
