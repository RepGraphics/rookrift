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

async function fixture(t,options={}){
 const commands=[],awards=[];const db=await openDatabase(':memory:'),vault=createVault(randomBytes(32).toString('hex')),sessions=new Map();let creates=0,uncertain=false;
 for(const id of ['owner','buyer','other','admin','mod','scoped','123456789012345678']){await db.prepare('INSERT INTO users VALUES(?,?,NULL,?)').run(id,id,'private-token');await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(id),id,id+'-csrf',Date.now()+600000);}
 await db.prepare("INSERT INTO workspaces(id,owner_id,plan,subscription_status,created_at) VALUES('w','owner','cluster','active',1)").run();
 for(const [id,role,scope]of [['admin','admin',null],['mod','moderator',null],['scoped','admin','[]']])await db.prepare("INSERT INTO workspace_members VALUES(?,'w',?,?,?,1)").run(randomUUID(),id,role,scope);
 const stripe={webhooks:new Stripe('sk_test_fixture').webhooks,accounts:{create:async()=>({id:'acct_fixture'}),retrieve:async()=>({id:'acct_fixture',charges_enabled:true})},accountLinks:{create:async()=>({url:'https://connect.stripe.com/setup/test'})},checkout:{sessions:{
  create:async(input,options)=>{creates++;assert.equal(options.stripeAccount,'acct_fixture');assert.equal(options.idempotencyKey,'community-order-'+input.client_reference_id);let s=[...sessions.values()].find(s=>s.client_reference_id===input.client_reference_id);if(!s){s={id:'cs_'+input.client_reference_id,mode:'payment',client_reference_id:input.client_reference_id,metadata:input.metadata,amount_total:input.line_items[0].price_data.unit_amount,currency:input.line_items[0].price_data.currency,payment_status:'unpaid',status:'open',url:'https://checkout.stripe.com/c/pay/test'};sessions.set(s.id,s);}if(uncertain){uncertain=false;throw new Error('Lost response after Stripe accepted checkout');}return s;},
  retrieve:async(id,params,options)=>{assert.equal(options.stripeAccount,'acct_fixture');return sessions.get(id);}
 }}};
 const env={APP_URL:'http://localhost:3000',STRIPE_CONNECT_WEBHOOK_SECRET:'whsec_community_fixture'},store=createCommunityStore(db,env,stripe),service=createService(db,vault,async(server,vault,action,message)=>{if(action==='purchase'){commands.push({server_id:server.id,command:message});if(options.failCommand)throw new Error('Lost RCON reply');}return{output:'OK',players:[],latency:1};}),community=createCommunity(db);
 const site={slug:'test-community',title:'Test Community',summary:'Welcome',rules:'Be kind.',discord_url:'',enabled:true,join_requests_open:true,staff_applications_open:false,join_questions:['Why join us?'],staff_questions:['What can you offer the team?'],server_ids:[]};await community.saveSite('w',site);
 const rewards={roles:async()=>[{id:'223456789012345670',name:'Supporter'}],check:async(guild,id)=>{if(id!=='223456789012345670')throw Object.assign(new Error('Role is not assignable.'),{status:409});return 'Supporter';},award:async(guild,role,user,id)=>{awards.push({guild,role,user,id});return{preexisting:false};}};
 const app=createApp({db,vault,service,store,rewards,billing:{ready:false},env}),http=app.listen(0,'127.0.0.1');await once(http,'listening');
 t.after(async()=>{http.closeAllConnections();await new Promise(r=>http.close(r));await app.locals.flushAuditWrites();await db.close();});
 const request=async(path,method='GET',body,user='owner',csrf=true)=>{const r=await fetch('http://127.0.0.1:'+http.address().port+'/api'+path,{method,headers:{'Content-Type':'application/json',...(user?{Cookie:'rookrift_session='+user}:{}),...(csrf?{Origin:env.APP_URL,'X-CSRF-Token':user+'-csrf'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};};
 const settings={enabled:true,currency:'gbp',country:'GB',delivery_note:'Contact staff in Discord. Delivery within 24 hours.',refund_policy:'Contact staff before delivery to request a refund.'};
 async function openStore(){await store.settings('w',settings);await store.connect('w');await store.refreshAccount('w');await store.product('w',null,{title:'Starter kit',description:'A building starter kit delivered by staff.',price:500,game:'asa',published:true});return(await store.manage('w')).products[0];}
 const pay=id=>{const s=sessions.get(id);s.payment_status='paid';s.status='complete';s.payment_intent={id:'pi_'+s.client_reference_id,status:'succeeded',latest_charge:{id:'ch_'+s.client_reference_id,amount:s.amount_total,currency:s.currency,amount_refunded:0,disputed:false}};return s;};
 async function event(object,type='checkout.session.completed',account='acct_fixture',id=randomUUID()) {const body=JSON.stringify({id,type,account,data:{object}}),signature=stripe.webhooks.generateTestHeaderString({payload:body,secret:env.STRIPE_CONNECT_WEBHOOK_SECRET});const r=await fetch('http://127.0.0.1:'+http.address().port+'/api/webhooks/community-stripe',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body});return r.status;}
 return{db,vault,service,store,community,site,request,openStore,settings,sessions,pay,event,commands,awards,delivery:app.locals.delivery,get creates(){return creates;},loseResponse(){uncertain=true;}};
}

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
 const f=await fixture(t),p=await f.openStore(),body={product_id:p.id,identifier:'EOS-BUYER',request_id:randomUUID()},base='/public/communities/test-community/store';
 assert.equal((await f.request(base+'/checkout','POST',body,null)).status,401);assert.equal((await f.request(base+'/checkout','POST',body,'buyer',false)).status,403);
 assert.equal((await f.request(base+'/checkout','POST',{...body,amount:1},'buyer')).status,400);
 const results=await Promise.all([f.request(base+'/checkout','POST',body,'buyer'),f.request(base+'/checkout','POST',body,'buyer')]);assert.ok(results.every(r=>r.status===200));assert.equal(f.creates,1);
 const order=await f.db.prepare('SELECT * FROM store_orders WHERE id=?').get(body.request_id);assert.equal(order.amount,500);assert.equal(order.fulfillment_status,'awaiting_payment');
 assert.equal((await f.request('/community/store/orders/'+order.id+'/fulfill','POST',{note:'Delivered by staff.'})).status,409);
 assert.equal((await f.request(base+'/orders/'+order.id+'/refresh','POST',{},'other')).status,404);
 const session=f.pay(order.checkout_session_id);assert.equal(await f.event(session),200);assert.equal((await f.store.manage('w')).orders[0].fulfillment_status,'pending');
 const deliveries=await Promise.all([f.store.fulfill('w',order.id,{note:'Delivered at the community hub.'},{id:'owner',name:'Owner'}),f.store.fulfill('w',order.id,{note:'Second attempt.'},{id:'owner',name:'Owner'})].map(p=>p.then(()=>200,e=>e.status)));assert.deepEqual(deliveries.sort(),[200,409]);
 assert.equal((await f.request(base+'/orders','GET',null,'other')).body.length,0);const own=(await f.request(base+'/orders','GET',null,'buyer')).body[0];assert.equal(own.fulfillment_status,'fulfilled');assert.ok(!JSON.stringify(own).includes('acct_fixture'));assert.ok(!JSON.stringify(own).includes('stripe_account'));
 await f.store.product('w',p.id,{title:'Edited kit',description:'Different contents after purchase.',price:999,game:'ase',published:false});await f.store.settings('w',{...f.settings,enabled:false,delivery_note:'New delivery terms for future orders.'});await f.store.archive('w',p.id);
 const retained=(await f.store.buyerOrders('test-community',{id:'buyer'}))[0];assert.equal(retained.title,'Starter kit');assert.equal(retained.amount,500);assert.equal(retained.delivery_note,f.settings.delivery_note);
 assert.equal((await f.request(base)).status,404);assert.equal((await f.request(base+'/orders','GET',null,'buyer')).body.length,1);
});
test('signed Connect webhooks recover uncertain checkouts and reject price/account mismatches; refunds require review',async t=>{
 const f=await fixture(t),p=await f.openStore(),input={product_id:p.id,identifier:'EOS-BUYER',request_id:randomUUID()};f.loseResponse();await assert.rejects(f.store.checkout('test-community',{id:'buyer'},input),/Stripe is unavailable/);
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
 const orderId=randomUUID();await f.store.checkout(f.site.slug,{id:'buyer'},{product_id:p.id,identifier:'PLAYER-001',request_id:orderId});await f.store.removeCategory('w',category.id);const order=(await f.store.buyerOrders(f.site.slug,{id:'buyer'}))[0];assert.equal(order.category_name,'Building kits');assert.equal(order.image_url,'https://example.com/kit.webp');assert.equal((await f.store.manage('w')).products[0].category_id,null);
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
