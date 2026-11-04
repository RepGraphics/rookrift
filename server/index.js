import {openDatabase} from './db.js';
import {createVault} from './crypto.js';
import {createService} from './service.js';
import {createBilling} from './billing.js';
import {createApp} from './app.js';
import {createMetricsCache} from './cache.js';
import {startBot,sendAlert} from './bot.js';

let db,cache,server,bot,interval,stopping=false,active=false,cycle=0;
async function tick(){
  if(active||stopping)return;active=true;
  try{
    await service.runDueSchedules();await service.pollAll((ws,message)=>sendAlert(bot,ws,message));
    if(cycle++%15===0)await billing.reconcile();
    await db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
    await db.prepare('DELETE FROM oauth_states WHERE expires_at<?').run(Date.now());
  }catch{console.error('Background cycle failed; retrying next minute.');}finally{active=false;}
}
let service,billing;
async function stop(code=0){
  if(stopping)return;stopping=true;clearInterval(interval);bot?.destroy();
  const closing=server?new Promise(resolve=>server.close(resolve)):Promise.resolve();
  while(active)await new Promise(resolve=>setTimeout(resolve,100));
  await closing;await cache?.close();await db?.close();process.exit(code);
}
async function start(){
  if(!process.env.APP_URL)throw new Error('APP_URL is required.');
  if(process.env.NODE_ENV==='production'&&!process.env.APP_URL.startsWith('https://'))throw new Error('Production APP_URL must use HTTPS.');
  const vault=createVault(process.env.ENCRYPTION_KEY);
  db=await openDatabase();
  await db.acquireRuntimeLock(()=>{console.error('PostgreSQL runtime lease lost; stopping to prevent duplicate workers.');process.exit(1);});
  cache=createMetricsCache();cache.start();service=createService(db,vault);billing=createBilling(db);
  const app=createApp({db,vault,service,billing,cache,getBot:()=>bot});
  server=app.listen(Number(process.env.PORT||3000),()=>console.log('Rookrift is ready with PostgreSQL storage.'));
  interval=setInterval(tick,60000);void tick();
  startBot(db,service).then(client=>{if(stopping)client?.destroy();else bot=client;}).catch(()=>console.error('Discord bot could not connect. Check its token and restart to retry.'));
}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
start().catch(async()=>{console.error('Rookrift startup failed. Check APP_URL, ENCRYPTION_KEY, PostgreSQL connectivity, and that only one runtime is active.');await cache?.close();await db?.close().catch(()=>{});process.exit(1);});
