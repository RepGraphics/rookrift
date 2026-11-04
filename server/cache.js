import {createClient} from 'redis';
import {createHash} from 'node:crypto';

export function createMetricsCache({url=process.env.REDIS_URL,password=process.env.REDIS_PASSWORD,namespace,client,timeout=100}={}){
  const enabled=Boolean(url||client),pending=new Map();let failedUntil=0,closed=false;
  const prefix=namespace||`rookrift:v1:${createHash('sha256').update(process.env.APP_URL||'local').digest('hex').slice(0,16)}`;
  if(!client&&url){client=createClient({url,...(password?{password}:{}),disableOfflineQueue:true,commandsQueueMaxLength:100,socket:{connectTimeout:1500,reconnectStrategy:retries=>Math.min(250*2**Math.min(retries,4),5000)}});client.on('error',()=>{failedUntil=Date.now()+5000;});client.on('ready',()=>{failedUntil=0;});}
  async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Cache command timed out.')),timeout);})]);}finally{clearTimeout(timer);}}
  const cache={
    get status(){return!enabled?'disabled':!closed&&client?.isReady&&Date.now()>=failedUntil?'ready':'degraded';},
    start(){if(enabled&&!client.isOpen)client.connect().catch(()=>{failedUntil=Date.now()+5000;});},
    async remember(key,ttl,load){
      if(!enabled||closed)return load();
      const storedKey=`${prefix}:metrics:${createHash('sha256').update(key).digest('hex')}`;
      if(pending.has(storedKey))return pending.get(storedKey);
      const task=(async()=>{
        if(cache.status==='ready')try{const cached=await bounded(client.get(storedKey));if(cached!==null)return JSON.parse(cached);}catch{failedUntil=Date.now()+5000;}
        const value=await load();
        if(cache.status==='ready')try{await bounded(client.set(storedKey,JSON.stringify(value),{EX:ttl}));}catch{failedUntil=Date.now()+5000;}
        return value;
      })();pending.set(storedKey,task);
      try{return await task;}finally{pending.delete(storedKey);}
    },
    async close(){closed=true;if(client?.isOpen)client.destroy();pending.clear();}
  };
  return cache;
}
