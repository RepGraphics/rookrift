import React from 'react';
import {RefreshCw} from 'lucide-react';
import {Button,Field} from './ui';
const sourceNames={a2s:'A2S query','minecraft-query':'Minecraft Query','minecraft-rcon':'Minecraft RCON','pterodactyl-file':'Pterodactyl configuration','pterodactyl-startup':'Pterodactyl startup','pelican-file':'Pelican configuration','pelican-startup':'Pelican startup','nitrado-query':'Nitrado query','nitrado-config':'Nitrado configuration',demo:'Simulated demo'};
export function ServerMetadataFields({server,game,automatic,setAutomatic}){
 return <>
  <label className="checkbox-label"><input type="checkbox" checked={automatic} onChange={event=>setAutomatic(event.target.checked)}/> Detect map/world and player capacity automatically</label>
  <p className="footnote">{game==='asa'?'ASA discovery uses a supported hosting connection.':'Uses supported game queries and hosting metadata.'} Existing manual labels are preserved until you enable this option.</p>
  <div className="form-grid"><Field label="Map / world"><input name="map" key={'map-'+game+'-'+automatic} disabled={automatic} required={!automatic} defaultValue={server?.game===game?server.map||'':automatic?'':game==='minecraft'?'world':game==='dayz'?'Chernarus':'The Island'} maxLength={60} placeholder={automatic?'Waiting for discovery':'Your map or world'}/></Field><Field label="Player slots"><input name="max_players" key={'slots-'+automatic} disabled={automatic} required={!automatic} type="number" defaultValue={server?.max_players??(automatic?'':70)} min={1} max={1000} placeholder={automatic?'Waiting for discovery':undefined}/></Field></div>
  <Field label="Query port (optional)" hint={game==='minecraft'?'Minecraft Query UDP port when enable-query=true. RCON can read capacity without it; a hosting connection can read the world name.':game==='asa'?'ASA uses hosting metadata; this field does not enable an ASE query service.':'Actual A2S UDP query port, separate from RCON. A supported hosting connection may supply it.'}><input name="query_port" type="number" min={1} max={65535} defaultValue={server?.query_port||''} placeholder="Enter the configured query port"/></Field>
 </>;
}
export function ServerMetadataStatus({server,busy,onRefresh}){
 const data=server.detected_metadata||{},date=value=>value?new Date(value).toLocaleString('en-GB'):'Not yet detected';
 return <section className="panel padded server-detected-details"><div className="section-heading"><div><h3>Server details</h3><p>{server.metadata_auto?'Automatic map/world and capacity.':'Manual map/world and capacity. Enable automatic discovery in Edit connection.'}</p></div><Button secondary icon={RefreshCw} disabled={busy||server.paused} onClick={onRefresh}>Refresh detected details</Button></div><div className="form-grid">{[['map','Map / world'],['max_players','Player capacity']].map(([key,label])=><div key={key}><strong>{label}</strong><p>{server[key]===null||server[key]===undefined||server[key]===''?'Not discovered':server[key]}</p>{data[key]!==undefined&&<small>Detected: {data[key]} · {sourceNames[data[key+'_source']]||'Server metadata'} · {date(data[key+'_checked_at'])}</small>}</div>)}</div>{data.warning&&<p className="footnote">{data.warning} Last known values are retained when a source is unavailable.</p>}<p className="footnote">{data.checked_at?'Last discovery attempt: '+date(data.checked_at):'Discovery runs after connecting, then about every five minutes.'} Hosting configuration may await a restart or be overridden by custom startup commands.</p></section>;
}
export function demoDiscoverMetadata(server){
 const now=Date.now(),map=server.map||({asa:'TheIsland_WP',ase:'TheIsland',minecraft:'world',dayz:'chernarusplus'})[server.game],max=server.max_players||20;
 server.detected_metadata={map,max_players:max,map_source:'demo',max_players_source:'demo',map_checked_at:now,max_players_checked_at:now,checked_at:now,last_success_at:now,status:'ready',warning:''};
 if(server.metadata_auto){server.map=map;server.max_players=max;}return server;
}
