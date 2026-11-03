import https from 'node:https';
import { isIP } from 'node:net';
import { resolveTarget } from './games.js';
export async function securePanelRequest(origin, path, key, method = 'GET', body) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Object.assign(new Error('Use an HTTPS panel origin without a path, query, or credentials.'),{status:400});
  const hostname = url.hostname.replace(/^\[|\]$/g,'');
  let address;try{address = await resolveTarget(hostname, process.env.ALLOW_PRIVATE_HOSTING === 'true');}catch(error){throw Object.assign(new Error(error.status===400?'The panel must resolve to a public address. Private hosting panels require explicit operator configuration.':'Unable to resolve the hosting panel address.'),{status:error.status===400?400:502});}
  return new Promise((resolve,reject) => {
    let complete=false;
    const finish=(error,value)=>{if(complete)return;complete=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
    const request=https.request({ hostname, port:url.port || 443, path, method, family:isIP(address),
      lookup:(_,options,callback)=>options.all ? callback(null,[{address,family:isIP(address)}]) : callback(null,address,isIP(address)),
      headers:{ Authorization:`Bearer ${key}`,Accept:'application/vnd.pterodactyl.v1+json','Content-Type':'application/json' }
    },response=>{
      if(response.statusCode<200 || response.statusCode>=300){response.resume();finish(Object.assign(new Error(response.statusCode===401||response.statusCode===403?'Hosting credentials or permissions were rejected.':response.statusCode===429?'The hosting panel is rate limiting requests. Try again shortly.':'The hosting panel request failed. Check the server ID and panel availability.'),{status:502}));return;}
      let data='',bytes=0;response.on('data',chunk=>{bytes+=chunk.length;if(bytes>1048576){response.destroy();finish(Object.assign(new Error('Hosting response exceeded the size limit.'),{status:502}));return;}data+=chunk;});
      response.on('end',()=>{try{finish(null,data?JSON.parse(data):{});}catch{finish(Object.assign(new Error('The hosting panel returned invalid JSON.'),{status:502}));}});
      response.on('error',()=>finish(Object.assign(new Error('Hosting response interrupted.'),{status:502})));
    });
    const timer=setTimeout(()=>request.destroy(new Error('Timeout')),10000);
    request.on('error',()=>finish(Object.assign(new Error('Unable to reach the hosting panel over verified HTTPS.'),{status:502})));
    if(body!==undefined)request.write(JSON.stringify(body));request.end();
  });
}
const attributes=value=>value?.attributes || value || {};
export function createHostingAdapter(request = securePanelRequest) {
  const base=connection=>`/api/client/servers/${encodeURIComponent(connection.remote_id)}`;
  const call=(connection,path,method,body)=>request(connection.origin,base(connection)+path,connection.key,method,body);
  return {
    async resources(connection) {
      const data=attributes(await call(connection,'/resources'));
      if(typeof data.current_state!=='string'||!data.resources||typeof data.resources!=='object'||Array.isArray(data.resources))throw Object.assign(new Error('The panel did not return a valid Pterodactyl resource response.'),{status:502});
      const resources=data.resources || {};
      const number=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
      return { state:String(data.current_state || 'unknown'),cpu:number(resources.cpu_absolute),memory_bytes:number(resources.memory_bytes),disk_bytes:number(resources.disk_bytes),uptime_ms:number(resources.uptime) };
    },
    async backups(connection) {
      const data=await call(connection,'/backups');
      if(!Array.isArray(data.data))throw Object.assign(new Error('The panel did not return a valid Pterodactyl backup list.'),{status:502});
      return (data.data || []).slice(0,100).map(row=>{const value=attributes(row);return {id:String(value.uuid || ''),name:String(value.name || 'Backup'),bytes:Number(value.bytes)||0,created_at:value.created_at || null,completed_at:value.completed_at || null,status:value.completed_at ? value.is_successful ? 'completed':'failed':'in progress'};});
    },
    async action(connection,action,name) {
      if(action==='backup'){const data=attributes(await call(connection,'/backups','POST',{name}));return {accepted:true,backup_id:String(data.uuid || ''),detail:'Backup creation accepted by the hosting panel.'};}
      if(!['start','stop','restart'].includes(action))throw Object.assign(new Error('Unsupported hosting action.'),{status:400});
      await call(connection,'/power','POST',{signal:action});return {accepted:true,detail:`${action[0].toUpperCase()+action.slice(1)} request accepted by the hosting panel.`};
    }
  };
}
