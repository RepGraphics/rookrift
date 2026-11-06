import {openDatabase} from './db.js';
import {createVault} from './crypto.js';
import {createService} from './service.js';
import {createBilling} from './billing.js';
import {createApp} from './app.js';
import {createMetricsCache} from './cache.js';
import {startBot,sendAlert} from './bot.js';
import {createPayPal} from './paypal.js';
import {createLinkMonitor} from './link-monitor.js';

let db,cache,server,bot,interval,workflows,workflowTimer,deliveryTimer,delivery,email,emailTimer,linkMonitor,stopping=false,active=false,cycle=0;
async function tick(){
  if(active||stopping)return;active=true;
  try{
    await service.runDueSchedules();await service.pollAll((ws,message)=>sendAlert(bot,ws,message));
    if(cycle++%15===0)await billing.reconcile();
    await store?.reconcile();
    await db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
    await db.prepare('DELETE FROM oauth_states WHERE expires_at<?').run(Date.now()); await db.prepare('DELETE FROM oauth_link_states WHERE expires_at<?').run(Date.now());
    await db.prepare('DELETE FROM login_challenges WHERE expires_at<?').run(Date.now());
    await db.prepare('DELETE FROM password_reset_tokens WHERE expires_at<?').run(Date.now());
  }catch{console.error('Background cycle failed; retrying next minute.');}finally{active=false;}
}
let service,billing,store,flushAuditWrites;
async function stop(code=0){
  if(stopping)return;stopping=true;clearInterval(interval);clearInterval(workflowTimer);clearInterval(deliveryTimer);clearInterval(emailTimer);
  const closing=server?new Promise(resolve=>server.close(resolve)):Promise.resolve();
  await email?.stop();await delivery?.stop();await linkMonitor?.stop();bot?.destroy();await workflows?.stop();while(active)await new Promise(resolve=>setTimeout(resolve,100));
  await closing;await flushAuditWrites?.();await cache?.close();await db?.close();process.exit(code);
}
async function start(){
  if(!process.env.APP_URL)throw new Error('APP_URL is required.');
  if(process.env.NODE_ENV==='production'&&!process.env.APP_URL.startsWith('https://'))throw new Error('Production APP_URL must use HTTPS.');
  const vault=createVault(process.env.ENCRYPTION_KEY);
  db=await openDatabase();
  const platformSettings=await db.prepare('SELECT key,value FROM platform_settings').all();
  const settingEnv={discord_client_id:'DISCORD_CLIENT_ID',discord_client_secret:'DISCORD_CLIENT_SECRET',discord_bot_token:'DISCORD_BOT_TOKEN',stripe_connect_secret_key:'STRIPE_CONNECT_SECRET_KEY',stripe_connect_webhook_secret:'STRIPE_CONNECT_WEBHOOK_SECRET',stripe_secret_key:'STRIPE_SECRET_KEY',stripe_webhook_secret:'STRIPE_WEBHOOK_SECRET',stripe_tribe_monthly_price_id:'STRIPE_TRIBE_MONTHLY_PRICE_ID',stripe_cluster_monthly_price_id:'STRIPE_CLUSTER_MONTHLY_PRICE_ID',paypal_client_id:'PAYPAL_CLIENT_ID',paypal_client_secret:'PAYPAL_CLIENT_SECRET',paypal_webhook_id:'PAYPAL_WEBHOOK_ID',paypal_tribe_plan_id:'PAYPAL_TRIBE_PLAN_ID',paypal_cluster_plan_id:'PAYPAL_CLUSTER_PLAN_ID',platform_billing_provider:'PLATFORM_BILLING_PROVIDER',paypal_ipn_tribe_url:'PAYPAL_IPN_TRIBE_URL',paypal_ipn_cluster_url:'PAYPAL_IPN_CLUSTER_URL',tebex_tribe_url:'TEBEX_TRIBE_URL',tebex_cluster_url:'TEBEX_CLUSTER_URL'};
  for(const setting of platformSettings){const name=settingEnv[setting.key];if(name&&!process.env[name])process.env[name]=vault.decrypt(setting.value);}
  await db.acquireRuntimeLock(()=>{console.error('PostgreSQL runtime lease lost; stopping to prevent duplicate workers.');process.exit(1);});
  await db.prepare('UPDATE users SET deleting_at=NULL WHERE deleting_at IS NOT NULL').run();
  cache=createMetricsCache();cache.start();service=createService(db,vault);const paypal=createPayPal();billing=createBilling(db,process.env,undefined,paypal);
  const app=createApp({db,vault,service,billing,paypal,cache,getBot:()=>bot});
  email=app.locals.email;await email.recover();
  delivery=app.locals.delivery;await delivery.recover();
  linkMonitor=createLinkMonitor(db,app.locals.operations,app.locals.members);app.locals.linkMonitor=linkMonitor;
  store=app.locals.store;flushAuditWrites=app.locals.flushAuditWrites;
  workflows=app.locals.workflows;await app.locals.configurations.recover();await workflows.recover();
  server=app.listen(Number(process.env.PORT||3000),()=>console.log('Rookrift is ready with PostgreSQL storage.'));
  deliveryTimer=setInterval(()=>delivery.tick().catch(()=>console.error('Purchase delivery cycle failed.')),5000);
  emailTimer=setInterval(()=>email.tick().catch(()=>console.error('Email delivery cycle failed; retrying next cycle.')),5000);
  interval=setInterval(tick,60000);void tick();
  workflowTimer=setInterval(()=>workflows.tick().catch(()=>console.error('Workflow cycle failed; it will retry.')),5000);
  void workflows.tick().catch(()=>console.error('Workflow cycle failed; it will retry.'));
  startBot(db,service,process.env,workflows,store).then(client=>{if(stopping)client?.destroy();else bot=client;}).catch(()=>console.error('Discord bot could not connect. Check its token and restart to retry.'));
}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
start().catch(async(error)=>{console.error('Rookrift startup failed:',error instanceof Error?error.message:error);await cache?.close();await db?.close().catch(()=>{});process.exit(1);});
