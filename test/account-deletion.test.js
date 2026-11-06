import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {openDatabase} from '../server/db.js';
import {createVault,hash,hashPassword} from '../server/crypto.js';
import {createApp} from '../server/app.js';
import {createService} from '../server/service.js';
import {createBilling} from '../server/billing.js';
import {createAccountDeletion} from '../server/account-deletion.js';
import {audit} from '../server/db.js';
import {staffAudit} from '../server/team.js';
import {createCommunityStore} from '../server/community-store.js';

async function fixture(t){
 const db=await openDatabase(':memory:'),vault=createVault(randomBytes(32).toString('hex')),password='A strong fixture password';
 for(const id of ['owner','other','buyer']){await db.prepare('INSERT INTO users(id,name,access_token) VALUES(?,?,?)').run(id,id,'private-token');await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(id),id,id+'-csrf',Date.now()+600000);}
 await db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?)').run('owner','owner@example.test',await hashPassword(password),Date.now());
 for(const [id,owner]of [['own','owner'],['theirs','other']])await db.prepare('INSERT INTO workspaces(id,owner_id,name,created_at) VALUES(?,?,?,?)').run(id,owner,id,Date.now());
 const state={subscriptions:[],sessions:[],fail:false,expired:[],created:0,hold:null};
 const stripe={subscriptions:{list:async({customer})=>{if(state.fail)throw new Error('Provider down');return{data:state.subscriptions.filter(s=>s.customer===customer),has_more:false};},retrieve:async id=>state.subscriptions.find(s=>s.id===id)},checkout:{sessions:{list:async({customer})=>({data:state.sessions.filter(s=>s.customer===customer&&s.status==='open'),has_more:false}),expire:async id=>{state.expired.push(id);const s=state.sessions.find(s=>s.id===id);if(s)s.status='expired';return s;},create:async input=>{state.created++;if(state.hold)await state.hold;const s={id:'cs_'+state.created,mode:'subscription',status:'open',customer:input.customer,url:'https://checkout.stripe.com/test'};state.sessions.push(s);return s;}}},prices:{retrieve:async()=>({active:true,currency:'gbp',unit_amount:399,recurring:{interval:'month',interval_count:1}})}};
 const env={APP_URL:'http://localhost:3000',STRIPE_WEBHOOK_SECRET:'whsec_fixture',STRIPE_TRIBE_MONTHLY_PRICE_ID:'price_tribe',STRIPE_CLUSTER_MONTHLY_PRICE_ID:'price_cluster',DISCORD_CLIENT_ID:'fixture',DISCORD_CLIENT_SECRET:'fixture',DISCORD_REDIRECT_URI:'http://localhost:3000/auth/discord/callback'},billing=createBilling(db,env,stripe),service=createService(db,vault,async()=>({output:'OK',players:[],latency:1}));
 const server=await service.addServer('own',{name:'Owned world',game:'asa',map:'Island',host:'8.8.8.8',port:27020,password:'private-rcon'}),otherServer=await service.addServer('theirs',{name:'Other world',game:'ase',map:'Island',host:'8.8.4.4',port:27020,password:'private-rcon'});
 const app=createApp({db,vault,service,billing,env}),http=app.listen(0,'127.0.0.1');await once(http,'listening');let proof='';
 t.after(async()=>{http.closeAllConnections();await new Promise(r=>http.close(r));try{await app.locals.flushAuditWrites();}finally{await db.close();}});
 const base='http://127.0.0.1:'+http.address().port;
 const request=async(path,method='GET',body,who='owner',csrf=true,extra={})=>{const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(who?{Cookie:'rookrift_session='+who+'; rookrift_delete_proof='+proof}:{}),...(csrf?{Origin:env.APP_URL,'X-CSRF-Token':who+'-csrf'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});const cookie=r.headers.getSetCookie().find(c=>c.startsWith('rookrift_delete_proof='));if(cookie)proof=cookie.split(';')[0].split('=')[1];return{status:r.status,body:await r.json(),headers:r.headers};};
 const verified=()=>request('/account/deletion/password','POST',{password});const input={confirmation:'DELETE',acknowledged:true};
 return{db,vault,env,billing,service,app,state,server,otherServer,password,base,request,verified,input,get proof(){return proof;}};
}

test('deletion requires CSRF, fresh account-owned identity proof and exact confirmation',async t=>{
 const f=await fixture(t);assert.equal((await f.request('/account/deletion','DELETE',f.input)).status,401);assert.equal((await f.request('/account/deletion/password','POST',{password:f.password},'owner',false)).status,403);assert.equal((await f.request('/account/deletion/password','POST',{password:'incorrect'})).status,401);assert.equal((await f.verified()).status,200);
 assert.equal((await f.request('/account/deletion','DELETE',{confirmation:'delete',acknowledged:true})).status,400);assert.equal((await f.request('/account/deletion','DELETE',f.input,'other')).status,401);await f.db.prepare('UPDATE account_deletion_proofs SET expires_at=1').run();assert.equal((await f.request('/account/deletion','DELETE',f.input)).status,401);assert.ok(await f.db.prepare("SELECT id FROM users WHERE id='owner'").get());
});

test('every owned workspace is checked against current provider state, including stale local cancellation',async t=>{
 const f=await fixture(t);await f.db.prepare("UPDATE workspaces SET customer_id='cus_own',subscription_id='sub_own',subscription_status='canceled' WHERE id='own'").run();f.state.subscriptions=[{id:'sub_own',customer:'cus_own',status:'active',cancel_at_period_end:false}];await f.verified();assert.equal((await f.request('/account/deletion')).body.allowed,false);assert.equal((await f.request('/account/deletion','DELETE',f.input)).status,409);
 f.state.subscriptions[0].cancel_at_period_end=true;assert.equal((await f.request('/account/deletion')).body.allowed,true);await f.db.prepare("INSERT INTO workspaces(id,owner_id,name,plan,subscription_status,created_at) VALUES('second','owner','Another cluster','cluster','active',2)").run();assert.equal((await f.request('/account/deletion')).body.allowed,false);f.state.fail=true;assert.equal((await f.request('/account/deletion')).body.memberships.find(w=>w.workspace_id==='own').allowed,false);assert.ok(await f.db.prepare("SELECT id FROM users WHERE id='owner'").get());
});

test('closure erases credentials and owned operations, revokes sessions, and preserves limited shared purchase records',async t=>{
 const f=await fixture(t),p1=randomUUID(),p2=randomUUID(),order=randomUUID(),ownOrder=randomUUID();
 for(const [p,ws]of [[p1,'own'],[p2,'theirs']])await f.db.prepare("INSERT INTO store_products(id,workspace_id,title,description,price,game,created_at,updated_at) VALUES(?,?,'Kit','Kit description',500,'asa',1,1)").run(p,ws);
 for(const [id,ws,buyer,p]of [[order,'theirs','owner',p2],[ownOrder,'own','buyer',p1]]){await f.db.prepare("INSERT INTO store_orders(id,workspace_id,user_id,product_id,title,game,identifier,amount,currency,stripe_account_id,payment_status,fulfillment_status,created_at,updated_at,discord_user_id) VALUES(?,?,?,?,'Kit','asa','PRIVATE-GAME-ID',500,'gbp','acct_fixture','paid','pending',1,1,'123456789012345678')").run(id,ws,buyer,p);await f.db.prepare("INSERT INTO store_delivery_jobs(id,workspace_id,order_id,position,type,payload,created_at,updated_at) VALUES(?,?,?,0,'rcon','{\"private\":true}',1,1)").run(randomUUID(),ws,id);}
 await f.db.prepare("INSERT INTO sessions VALUES(?,'owner','second',9876543210000)").run(hash('second-session'));await f.db.prepare("INSERT INTO workspace_members VALUES(?,'theirs','owner','viewer',NULL,1)").run(randomUUID());await f.verified();assert.equal((await f.request('/account/deletion','DELETE',f.input)).status,200);
 assert.equal(await f.db.prepare("SELECT id FROM users WHERE id='owner'").get(),undefined);assert.equal(await f.db.prepare("SELECT user_id FROM local_accounts WHERE email='owner@example.test'").get(),undefined);assert.equal((await f.db.prepare("SELECT count(*) AS n FROM sessions WHERE user_id='owner'").get()).n,0);assert.equal((await f.db.prepare("SELECT count(*) AS n FROM servers WHERE workspace_id='own'").get()).n,0);assert.ok(await f.db.prepare('SELECT id FROM servers WHERE id=?').get(f.otherServer.id));
 const closed=await f.db.prepare("SELECT * FROM workspaces WHERE id='own'").get();assert.equal(closed.owner_id,'deleted-account');assert.ok(closed.closed_at);const retained=await f.db.prepare('SELECT * FROM store_orders WHERE id=?').get(order);assert.equal(retained.user_id,'deleted-account');assert.equal(retained.identifier,'');assert.equal(retained.discord_user_id,null);assert.equal(retained.amount,500);assert.equal(retained.fulfillment_status,'review_required');assert.ok((await f.db.prepare('SELECT status FROM store_delivery_jobs').all()).every(j=>j.status==='cancelled'));assert.equal((await f.request('/account')).status,401);
 await audit(f.db,'own','Late event','Must not repopulate a closed workspace');assert.equal((await f.db.prepare("SELECT count(*) AS n FROM activity WHERE workspace_id='own'").get()).n,0);await staffAudit(f.db,'theirs',{id:'owner',name:'Old identifying name'},'Late action');const entry=await f.db.prepare("SELECT actor,user_id FROM staff_audit WHERE workspace_id='theirs'").get();assert.equal(entry.actor,'Deleted member');assert.equal(entry.user_id,'deleted-account');
});

test('executing work blocks erasure and the closing fence is cleared for a safe retry',async t=>{
 const f=await fixture(t);await f.db.prepare("INSERT INTO workflow_runs(id,workspace_id,server_id,name,trigger_type,actor,status,steps,next_step_at,created_at,updated_at) VALUES(?,'own',?,'Long workflow','manual','Owner','waiting','[]',1,1,1)").run(randomUUID(),f.server.id);await f.verified();assert.equal((await f.request('/account/deletion','DELETE',f.input)).status,409);assert.equal((await f.db.prepare("SELECT deleting_at FROM users WHERE id='owner'").get()).deleting_at,null);assert.ok(await f.service.getServer('own',f.server.id));
});

test('pending subscription checkouts expire and cannot race a deletion into a new charge',async t=>{
 const f=await fixture(t);await f.db.prepare("UPDATE workspaces SET customer_id='cus_own' WHERE id='own'").run();await f.verified();let release;f.state.hold=new Promise(r=>{release=r;});const checkout=f.billing.checkout(await f.db.prepare("SELECT * FROM workspaces WHERE id='own'").get(),'tribe');while(!f.state.created)await new Promise(r=>setTimeout(r,5));const closure=f.request('/account/deletion','DELETE',f.input);release();await checkout;assert.equal((await closure).status,200);assert.deepEqual(f.state.expired,['cs_1']);await assert.rejects(f.billing.checkout({id:'own'},'tribe'),/closed|deletion/);assert.equal(f.state.created,1);
});

test('support impersonation cannot obtain a deletion proof or erase the target account',async t=>{
 const f=await fixture(t);await f.db.prepare("INSERT INTO platform_impersonations VALUES(?,'other',1)").run(hash('owner'));assert.equal((await f.verified()).status,403);assert.equal((await f.request('/account/deletion','DELETE',f.input)).status,403);assert.ok(await f.db.prepare("SELECT id FROM users WHERE id='owner'").get());
});

test('passkey deletion proof is bound to the account, session, challenge and current stored credential',async t=>{
 const f=await fixture(t);await f.db.prepare("INSERT INTO account_passkeys VALUES('key','owner','credential',?,0,'[]','Key',1,NULL)").run(Buffer.from([1,2,3]));let verified=0;const engine=createAccountDeletion(f.db,{billing:f.billing,service:f.service,store:f.app.locals.store,account:{verifyTotp:async()=>true},env:f.env,webauthn:{generateAuthenticationOptions:async()=>({challenge:'expected'}),verifyAuthenticationResponse:async options=>{verified++;assert.equal(options.expectedChallenge,'expected');assert.equal(options.credential.id,'credential');assert.equal(options.expectedOrigin,f.env.APP_URL);return{verified:true,authenticationInfo:{newCounter:1}};}}}),session={token_hash:hash('owner')},options=await engine.passkeyOptions('owner',session);
 await assert.rejects(engine.passkey('other',session,{challenge_id:options.challenge_id,response:{id:'credential'}}),/expired/);const proof=await engine.passkey('owner',session,{challenge_id:options.challenge_id,response:{id:'credential'}});assert.equal(verified,1);assert.ok((await engine.status('owner',session,proof)).reauthenticated);await assert.rejects(engine.passkey('owner',session,{challenge_id:options.challenge_id,response:{id:'credential'}}),/expired/);
});

test('public legal metadata contains operator contact details and no private configuration',async t=>{
 const f=await fixture(t),r=await f.request('/legal','GET',null,null);assert.equal(r.status,200);assert.equal(r.body.operator,'Euphoria Development');assert.equal(r.body.email,'support@euphoriadevelopment.uk');assert.equal(r.body.country,'United Kingdom');assert.equal(r.body.address,'');assert.ok(!JSON.stringify(r.body).includes('whsec_'));assert.ok(!JSON.stringify(r.body).includes('DISCORD_CLIENT_SECRET'));
});

test('Discord deletion reauthentication is bound to the original session and exact linked Discord identity',async t=>{
 const f=await fixture(t),discordId='123456789012345678';await f.db.prepare('UPDATE users SET discord_id=? WHERE id=?').run(discordId,'owner');const original=globalThis.fetch;let identity=discordId;
 globalThis.fetch=async(url,options)=>{if(String(url)==='https://discord.com/api/v10/oauth2/token')return new Response(JSON.stringify({access_token:'oauth-fixture'}),{status:200,headers:{'Content-Type':'application/json'}});if(String(url)==='https://discord.com/api/v10/users/@me')return new Response(JSON.stringify({id:identity}),{status:200,headers:{'Content-Type':'application/json'}});return original(url,options);};t.after(()=>{globalThis.fetch=original;});
 const begin=await fetch(f.base+'/auth/discord/delete-confirm',{redirect:'manual',headers:{Cookie:'rookrift_session=owner'}});const state=new URL(begin.headers.get('Location')).searchParams.get('state');assert.ok(state);
 const callback=f.base+'/auth/discord/callback?state='+state+'&code=fixture';const mismatch=await fetch(callback,{redirect:'manual',headers:{Cookie:'rookrift_session=other; rookrift_oauth_delete='+state}});assert.equal(mismatch.status,400);
 identity='223456789012345678';const wrong=await fetch(callback,{redirect:'manual',headers:{Cookie:'rookrift_session=owner; rookrift_oauth_delete='+state}});assert.equal(wrong.status,403);
 identity=discordId;const again=await fetch(f.base+'/auth/discord/delete-confirm',{redirect:'manual',headers:{Cookie:'rookrift_session=owner'}}),fresh=new URL(again.headers.get('Location')).searchParams.get('state');const success=await fetch(f.base+'/auth/discord/callback?state='+fresh+'&code=fixture',{redirect:'manual',headers:{Cookie:'rookrift_session=owner; rookrift_oauth_delete='+fresh}});assert.equal(success.status,302);assert.ok(success.headers.get('Location').endsWith('?account=delete-verified'));const cookie=success.headers.getSetCookie().find(c=>c.startsWith('rookrift_delete_proof='));assert.ok(cookie.includes('HttpOnly'));assert.ok(cookie.includes('Path=/api/account/deletion'));const token=cookie.split(';')[0].split('=')[1];assert.equal((await f.request('/account/deletion','DELETE',f.input,'owner',true,{Cookie:'rookrift_session=owner; rookrift_delete_proof='+token})).status,200);
});

test('an existing second factor is still required after fresh password or passkey verification',async t=>{
 const f=await fixture(t),engine=createAccountDeletion(f.db,{billing:f.billing,service:f.service,store:f.app.locals.store,account:{verifyTotp:async(_,code)=>code==='123456'},env:f.env}),session={token_hash:hash('owner')},proof=await engine.password('owner',session,{password:f.password});await assert.rejects(engine.remove('owner',session,proof,f.input),/authenticator/);assert.ok(await f.db.prepare("SELECT id FROM users WHERE id='owner'").get());assert.deepEqual(await engine.remove('owner',session,proof,{...f.input,totp:'123456'}),{ok:true});
});

test('Discord deletion verification returns to a validated community address and rejects external redirects',async t=>{
 const f=await fixture(t),discordId='123456789012345678';await f.db.prepare('UPDATE users SET discord_id=? WHERE id=?').run(discordId,'buyer');
 const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{if(String(url)==='https://discord.com/api/v10/oauth2/token')return new Response(JSON.stringify({access_token:'oauth-fixture'}),{status:200,headers:{'Content-Type':'application/json'}});if(String(url)==='https://discord.com/api/v10/users/@me')return new Response(JSON.stringify({id:discordId}),{status:200,headers:{'Content-Type':'application/json'}});return original(url,options);};t.after(()=>{globalThis.fetch=original;});
 const target='/c/our-community?page=account';
 const begin=await fetch(f.base+'/auth/discord/delete-confirm?return_to='+encodeURIComponent(target),{redirect:'manual',headers:{Cookie:'rookrift_session=buyer'}}),state=new URL(begin.headers.get('Location')).searchParams.get('state');
 assert.ok(begin.headers.getSetCookie().some(cookie=>cookie.startsWith('rookrift_delete_return=')&&cookie.includes(encodeURIComponent(target))));
 const success=await fetch(f.base+'/auth/discord/callback?state='+state+'&code=fixture',{redirect:'manual',headers:{Cookie:'rookrift_session=buyer; rookrift_oauth_delete='+state+'; rookrift_delete_return='+encodeURIComponent(target)}});assert.equal(success.status,302);assert.equal(success.headers.get('Location'),f.env.APP_URL+target);
 assert.equal((await f.db.prepare("SELECT count(*) AS total FROM workspaces WHERE owner_id='buyer'").get()).total,0);
 const again=await fetch(f.base+'/auth/discord/delete-confirm?return_to=https://example.com',{redirect:'manual',headers:{Cookie:'rookrift_session=buyer'}}),fresh=new URL(again.headers.get('Location')).searchParams.get('state');
 const safe=await fetch(f.base+'/auth/discord/callback?state='+fresh+'&code=fixture',{redirect:'manual',headers:{Cookie:'rookrift_session=buyer; rookrift_oauth_delete='+fresh+'; rookrift_delete_return='+encodeURIComponent('https://example.com')}});assert.equal(safe.headers.get('Location'),f.env.APP_URL+'/dashboard?account=delete-verified');
});

async function checkoutFixture(f,workspace,buyer,{uncertain=false}={}){
 const id=randomUUID(),product=randomUUID();let started,release;
 const entered=new Promise(r=>{started=r;}),hold=new Promise(r=>{release=r;}),session={id:'cs_store',status:'open',url:'https://checkout.stripe.com/test'};
 await f.db.prepare("INSERT INTO community_sites(workspace_id,slug,title,enabled,updated_at) VALUES(?,?,'Store',1,1)").run(workspace,'store-'+workspace);
 await f.db.prepare("INSERT INTO community_stores(workspace_id,enabled,stripe_account_id,charges_enabled,updated_at) VALUES(?,1,'acct_store',1,1)").run(workspace);
 await f.db.prepare("INSERT INTO store_products(id,workspace_id,title,description,price,game,published,created_at,updated_at) VALUES(?,?,'Kit','A test kit for players',500,'asa',1,1,1)").run(product,workspace);
 const stripe={accounts:{retrieve:async()=>({id:'acct_store',charges_enabled:true})},checkout:{sessions:{create:async()=>{started();await hold;if(uncertain)throw new Error('Lost checkout response');return session;},retrieve:async()=>session,expire:async()=>{session.status='expired';return session;}}}},store=createCommunityStore(f.db,{...f.env,STRIPE_CONNECT_WEBHOOK_SECRET:'fixture'},stripe),engine=createAccountDeletion(f.db,{billing:f.billing,service:f.service,store,account:{verifyTotp:async()=>true},env:f.env}),auth={token_hash:hash('owner')},proof=await engine.password('owner',auth,{password:f.password});
 return{id,store,engine,auth,proof,entered,release,session,start:()=>store.checkout('store-'+workspace,{id:buyer},{product_id:product,identifier:'0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',request_id:id})};
}

test('closing a buyer or merchant account waits for an in-flight store checkout and expires its payment link',async t=>{
 for(const [workspace,buyer]of [['theirs','owner'],['own','buyer']])await t.test(workspace,async t=>{
  const f=await fixture(t),c=await checkoutFixture(f,workspace,buyer),checkout=c.start();await c.entered;const deletion=c.engine.remove('owner',c.auth,c.proof,f.input);c.release();await checkout;await deletion;assert.equal(c.session.status,'expired');assert.equal(await f.db.prepare("SELECT id FROM users WHERE id='owner'").get(),undefined);
 });
});

test('an uncertain checkout response remains fenced until its payment link has expired',async t=>{
 const f=await fixture(t),c=await checkoutFixture(f,'theirs','owner',{uncertain:true}),checkout=c.start();await c.entered;c.release();await assert.rejects(checkout,/Stripe is unavailable/);const row=await f.db.prepare('SELECT * FROM store_orders WHERE id=?').get(c.id);assert.ok(row.checkout_attempted_at);assert.equal(row.checkout_session_id,null);await assert.rejects(c.engine.remove('owner',c.auth,c.proof,f.input),/checkout could not be verified/);assert.equal((await f.db.prepare("SELECT deleting_at FROM users WHERE id='owner'").get()).deleting_at,null);await f.db.prepare('UPDATE store_orders SET created_at=? WHERE id=?').run(Date.now()-3661000,c.id);await c.engine.remove('owner',c.auth,c.proof,f.input);assert.equal(await f.db.prepare("SELECT id FROM users WHERE id='owner'").get(),undefined);
});
