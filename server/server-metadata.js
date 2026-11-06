import {a2sInfo,minecraftQuery,cleanServerMetadata} from './server-query.js';
import {createHostingAdapter} from './hosting.js';
import {runRcon} from './games.js';

export function createMetadataDiscovery(db,vault,{hosting=createHostingAdapter(),a2s=a2sInfo,minecraft=minecraftQuery,rcon=runRcon}={}){
 return async function discover(server){
  const connection=await db.prepare('SELECT * FROM hosting_connections WHERE server_id=? AND workspace_id=?').get(server.id,server.workspace_id);
  let configured={},native={},rconData={},warning='';
  if(connection){try{configured=await hosting.metadata({...connection,key:vault.decrypt(connection.api_key)},server.game);}catch{warning='Hosting metadata is unavailable. Check its read permissions.';}}
  const port=server.query_port||configured.query_port;
  const probes=[];
  if(port&&['ase','dayz','minecraft'].includes(server.game))probes.push((server.game==='minecraft'?minecraft:a2s)({host:server.host,port}).then(data=>{native=cleanServerMetadata(data);}).catch(()=>{warning='The query did not return supported metadata. Check the query port, protocol and firewall.';}));
  if(server.game==='minecraft')probes.push(rcon(server,vault,'status').then(data=>{rconData=cleanServerMetadata(data.metadata||{});}).catch(()=>{}));
  await Promise.all(probes);
  const fallback=cleanServerMetadata(configured),values={...fallback,...native,...rconData},sources={};
  for(const key of ['map','max_players'])if(values[key]!==undefined)sources[key]=rconData[key]!==undefined?'minecraft-rcon':native[key]!==undefined?server.game==='minecraft'?'minecraft-query':'a2s':configured.sources?.[key]||'hosting-configuration';
  if(values.map===undefined&&!warning)warning=server.game==='asa'?'Connect a supported hosting provider to read ASA map and capacity.':'Map discovery needs a supported query service or hosting connection.';
  if(values.max_players===undefined&&!warning)warning='Capacity discovery needs a supported query service or hosting connection.';
  return{...values,sources,warning};
 };
}
