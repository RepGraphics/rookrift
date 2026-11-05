import {open,stat} from 'node:fs/promises';
import {StringDecoder} from 'node:string_decoder';

const path=process.env.LINK_LOG_PATH,endpoint=process.env.ROOKRIFT_LINK_ENDPOINT,token=process.env.ROOKRIFT_LINK_TOKEN,serverId=process.env.ROOKRIFT_SERVER_ID;
if(!path||!endpoint||!token||!serverId)throw new Error('LINK_LOG_PATH, ROOKRIFT_LINK_ENDPOINT, ROOKRIFT_LINK_TOKEN, and ROOKRIFT_SERVER_ID are required.');
let offset=0,identity=null,carry='',decoder=new StringDecoder('utf8'),busy=false,stopped=false;
const queue=[];
async function poll(){
 if(busy||stopped)return;busy=true;
 try{
  const info=await stat(path);if(!info.isFile())throw new Error('LINK_LOG_PATH must point to a log file inside the mounted /logs directory.');
  const nextIdentity=String(info.dev)+':'+String(info.ino)+':'+String(info.birthtimeMs);
  if(identity===null){identity=nextIdentity;offset=info.size;}
  else if(identity!==nextIdentity||info.size<offset){identity=nextIdentity;offset=0;carry='';decoder=new StringDecoder('utf8');}
  if(info.size>offset){
   const file=await open(path,'r');try{const buffer=Buffer.alloc(Math.min(65536,info.size-offset)),{bytesRead}=await file.read(buffer,0,buffer.length,offset);offset+=bytesRead;carry+=decoder.write(buffer.subarray(0,bytesRead));}finally{await file.close();}
   const lines=carry.split(/\r?\n/);carry=lines.pop()||'';if(carry.length>8192)carry='';
   for(const message of lines)if(message.length<=4096&&/\/link\s+RR-[A-F0-9]{10,32}/i.test(message)&&queue.length<100)queue.push({message,expires:Date.now()+30000});
  }
  while(queue.length&&!stopped){
   if(queue[0].expires<Date.now()){queue.shift();continue;}
   const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({server_id:serverId,message:queue[0].message}),signal:AbortSignal.timeout(5000)});
   if(response.status===429||response.status>=500)break;
   queue.shift();if(!response.ok)console.error('Link bridge event rejected ('+response.status+'). Check the server token and endpoint.');
  }
 }catch{console.error('Link bridge could not read or forward a log event. Check its file mount, endpoint and token.');}
 finally{busy=false;}
}
const timer=setInterval(()=>void poll(),1000);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopped=true;clearInterval(timer);});
await poll();
console.log('Rookrift log bridge is ready. Raw logs prompt native RCON chat checks; they do not verify player identities.');
