import https from 'node:https';
import { isIP } from 'node:net';
import { resolveTarget } from './games.js';
import {assertHostingCapability,hostingCapabilities} from '../shared/hosting-providers.js';
export async function securePanelRequest(origin, path, key, method = 'GET', body,options={}) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Object.assign(new Error('Use an HTTPS panel origin without a path, query, or credentials.'),{status:400});
  const hostname = url.hostname.replace(/^\[|\]$/g,'');
  let address;try{address = await resolveTarget(hostname, process.env.ALLOW_PRIVATE_HOSTING === 'true');}catch(error){throw Object.assign(new Error(error.status===400?'The panel must resolve to a public address. Private hosting panels require explicit operator configuration.':'Unable to resolve the hosting panel address.'),{status:error.status===400?400:502});}
  return new Promise((resolve,reject) => {
    let complete=false;
    const finish=(error,value)=>{if(complete)return;complete=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
    const request=https.request({ hostname, port:url.port || 443, path, method, family:isIP(address),
      lookup:(_,options,callback)=>options.all ? callback(null,[{address,family:isIP(address)}]) : callback(null,address,isIP(address)),
      headers:{ Authorization:`Bearer ${key}`,Accept:options.text?'text/plain':'application/json','Content-Type':options.form?'application/x-www-form-urlencoded':options.raw?'text/plain; charset=utf-8':'application/json' }
    },response=>{
      if(response.statusCode<200 || response.statusCode>=300){response.resume();finish(Object.assign(new Error(response.statusCode===401||response.statusCode===403?'Hosting credentials or permissions were rejected.':response.statusCode===429?'The hosting panel is rate limiting requests. Try again shortly.':'The hosting panel request failed. Check the server ID and panel availability.'),{status:502}));return;}
      response.setEncoding('utf8');let data='',bytes=0;response.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>1048576){response.destroy();finish(Object.assign(new Error('Hosting response exceeded the size limit.'),{status:502}));return;}data+=chunk;});
      response.on('end',()=>{try{finish(null,options.text?data:data?JSON.parse(data):{});}catch{finish(Object.assign(new Error('The hosting panel returned invalid JSON.'),{status:502}));}});
      response.on('error',()=>finish(Object.assign(new Error('Hosting response interrupted.'),{status:502})));
    });
    const timer=setTimeout(()=>request.destroy(new Error('Timeout')),10000);
    request.on('error',()=>finish(Object.assign(new Error('Unable to reach the hosting panel over verified HTTPS.'),{status:502})));
    if(body!==undefined)request.write(options.form?new URLSearchParams(body).toString():options.raw?body:JSON.stringify(body));request.end();
  });
}
const attributes=value=>value?.attributes || value || {};
function createPanelAdapter(request) {
  const base=connection=>`/api/client/servers/${encodeURIComponent(connection.remote_id)}`;
  const call=(connection,path,method,body,options)=>request(connection.origin,base(connection)+path,connection.key,method,body,options);
  return {
    readFile:(connection,path)=>call(connection,'/files/contents?file='+encodeURIComponent(path),'GET',undefined,{text:true}),
    writeFile:(connection,path,body)=>call(connection,'/files/write?file='+encodeURIComponent(path),'POST',body,{raw:true}),
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
    ,async backup(connection,id){
      if(!/^[a-f0-9-]{36}$/i.test(id))throw Object.assign(new Error('The provider did not return a valid backup reference.'),{status:400});
      const value=attributes(await call(connection,'/backups/'+encodeURIComponent(id)));
      return{id:String(value.uuid||id),status:value.completed_at?value.is_successful?'completed':'failed':'in progress',completed_at:value.completed_at||null};
    }
  };
}
export function createNitradoAdapter(request=securePanelRequest){
 const origin='https://api.nitrado.net';
 const fail=message=>{throw Object.assign(new Error(message),{status:502});};
 const call=async(c,suffix='',method='GET',body)=>{if(c.origin!==origin||!/^\d{1,14}$/.test(c.remote_id))throw Object.assign(new Error('Use the Nitrado API origin and a numeric service ID.'),{status:400});const result=await request(origin,'/services/'+c.remote_id+'/gameservers'+suffix,c.key,method,body,{form:method!=='GET'});if(result?.status!=='success')fail('Nitrado did not accept the request. Check service permissions and availability.');return result.data||{};};
 const details=async c=>{const d=(await call(c)).gameserver;if(!d||typeof d.status!=='string'||String(d.service_id)!==c.remote_id)fail('Nitrado did not return the requested game service.');return d;};
 return{
  async resources(c){const d=await details(c);return{state:({started:'running',stopped:'offline',stopping:'stopping',restarting:'starting',gs_installation:'starting',backup_restore:'starting',backup_creation:'running'})[d.status]||'unknown',provider_state:d.status,cpu:null,memory_bytes:null,disk_bytes:null,uptime_ms:null};},
  async action(c,action){assertHostingCapability('nitrado',action==='backup'?'backups':action);if(!['start','stop','restart'].includes(action))throw Object.assign(new Error('Unsupported hosting action.'),{status:400});if(action==='start'){const d=await details(c);if(d.status!=='stopped')throw Object.assign(new Error('Nitrado must report the service stopped before starting its current game.'),{status:409});if(typeof d.game!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(d.game))fail('Nitrado did not identify an installed current game. Start it once in the provider panel.');await call(c,'/games/start','POST',{game:d.game});}else await call(c,'/'+action,'POST',{message:'Requested through Rookrift'});return{accepted:true,detail:'Nitrado accepted the '+action+' request. Refresh status to verify the process transition.'};},
  async backups(){return[];}
 };
}
export function createHostingAdapter(request=securePanelRequest){
 const panel=createPanelAdapter(request),nitrado=createNitradoAdapter(request);
 const choose=c=>{if(!['pterodactyl','pelican','nitrado'].includes(c.provider||'pterodactyl'))throw Object.assign(new Error('Unsupported hosting provider.'),{status:400});return c.provider==='nitrado'?nitrado:panel;};
 return{
  capabilities:c=>hostingCapabilities(c.provider),
  resources:c=>choose(c).resources(c),
  backups:c=>choose(c).backups(c),
  action:(c,action,name)=>{assertHostingCapability(c.provider,action==='backup'?'backups':action);return choose(c).action(c,action,name);},
  backup:(c,id)=>{assertHostingCapability(c.provider,'backups');return choose(c).backup(c,id);},
  readFile:(c,path)=>{assertHostingCapability(c.provider,'files');return choose(c).readFile(c,path);},
  writeFile:(c,path,body)=>{assertHostingCapability(c.provider,'files');return choose(c).writeFile(c,path,body);}
 };
}
