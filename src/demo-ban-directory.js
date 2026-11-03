import {normalizeIdentity,tryIdentity} from '../shared/ban-identity';
export const DEMO_EOSID='0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const DEMO_UUID='9a5c2d10-7b43-4a80-a2f9-83a111222333';
const now=Date.now();
const reports=[
  {id:'sample-north',key:`eos:${DEMO_EOSID}`,community:'Northwatch (sample)',cluster:'Northern Isles',game:'asa',active:true,server_count:3,active_servers:2,first_reported_at:now-7*86400000,last_updated_at:now-86400000,withdrawn_at:null,evidence:'community_report'},
  {id:'sample-haven',key:`eos:${DEMO_EOSID}`,community:'Haven (sample)',cluster:'Legacy cluster',game:'ase',active:false,server_count:1,active_servers:0,first_reported_at:now-12*86400000,last_updated_at:now-2*86400000,withdrawn_at:now-2*86400000,evidence:'community_report'},
  {id:'sample-uuid',key:`uuid:${DEMO_UUID.replaceAll('-','')}`,community:'Northwatch (sample)',cluster:'Northern Isles',game:'asa',active:true,server_count:1,active_servers:1,first_reported_at:now-3*86400000,last_updated_at:now-3*86400000,withdrawn_at:null,evidence:'community_report'}
];
function paginate(items,page=1){return{items:items.slice((page-1)*25,page*25),total:items.length,page,page_size:25,has_more:page*25<items.length};}
export function demoOwnBans(data,{status='active',game='all',page=1,key=null}={}){
  const grouped=new Map();
  for(const row of data.moderation||[]){
    if(row.action!=='ban')continue;
    const server=data.servers.find(server=>server.id===row.server_id),identity=tryIdentity(row.identifier,row.identity_kind||'auto');
    if(!server||!identity||(key&&key!==identity.key)||(game!=='all'&&server.game!==game))continue;
    const cluster=server.cluster||server.name,id=`${identity.key}:${server.cluster?'cluster:'+server.cluster:'server:'+server.id}:${server.game}`;
    const group=grouped.get(id)||{id,identifier:identity.display,identity_kind:identity.kind,cluster,game:server.game,active:false,servers:new Set(),activeServers:new Set(),first_reported_at:row.created_at,last_updated_at:row.created_at,evidence:'command_acknowledged'};
    group.active ||= Boolean(row.active);group.servers.add(server.id);if(row.active)group.activeServers.add(server.id);
    group.first_reported_at=Math.min(group.first_reported_at,row.created_at);
    const unban=(data.moderation||[]).filter(item=>item.server_id===row.server_id&&item.action==='unban'&&tryIdentity(item.identifier,item.identity_kind||'auto')?.key===identity.key).map(item=>item.created_at);
    group.last_updated_at=Math.max(group.last_updated_at,row.created_at,...unban);grouped.set(id,group);
  }
  const items=[...grouped.values()].filter(row=>status==='all'||(status==='active')===row.active).map(({servers,activeServers,...row})=>({...row,server_count:servers.size,active_servers:activeServers.size})).sort((a,b)=>Number(b.active)-Number(a.active)||b.last_updated_at-a.last_updated_at||a.id.localeCompare(b.id));
  return paginate(items,page);
}
export function demoBanLookup(data,input){
  const identity=normalizeIdentity(input.identifier,input.identity_kind),game=input.game||'all',page=input.page||1;
  const community=reports.filter(row=>row.key===identity.key&&(game==='all'||row.game===game)&&(input.include_withdrawn||row.active)).map(({key,...row})=>row);
  return {identity:{kind:identity.kind,display:identity.display},game,own:demoOwnBans(data,{key:identity.key,status:input.include_withdrawn?'all':'active',game,page}),community:paginate(community,page),coverage:{participating_communities:2,source:'Fictional demo communities',verified_game_state:false},checked_at:Date.now()};
}
