import {z} from 'zod';
import {effectivePlan} from './plans.js';
import {identityFromKey} from '../shared/ban-identity.js';
import {PRESENCE_GAP_MS,playerSessionsCsv} from '../shared/player-activity.js';
const DAY=86400000;
const fail=message=>{throw Object.assign(new Error(message),{status:404});};
const closeSql="UPDATE player_sessions SET ended_at=last_seen,end_detected_at=GREATEST(last_seen,?),end_reason=? WHERE server_id=? AND ended_at IS NULL";

// Called inside observePlayers' transaction, after locking the server row and updating profiles.
export async function observePlayerSessions(db,server,now,previous){
 if(previous&&now<=previous.checked_at)return;
 const continuous=previous?.connected===1&&now-previous.checked_at<=PRESENCE_GAP_MS;
 const present="SELECT profile_id FROM player_observations WHERE server_id=? AND online=1 AND last_checked=?";
 await db.prepare(closeSql+' AND (?=0 OR profile_id NOT IN ('+present+'))').run(now,continuous?'not_seen':'monitoring_gap',server.id,Number(continuous),server.id,now);
 await db.prepare('UPDATE player_sessions s SET display_name=o.display_name,last_seen=?,samples=s.samples+1 FROM player_observations o WHERE s.server_id=? AND s.ended_at IS NULL AND o.server_id=s.server_id AND o.profile_id=s.profile_id AND o.online=1 AND o.last_checked=?').run(now,server.id,now);
 await db.prepare('INSERT INTO player_sessions(id,workspace_id,server_id,profile_id,display_name,started_at,last_seen,start_reason) SELECT gen_random_uuid()::text,?,o.server_id,o.profile_id,o.display_name,?,?,? FROM player_observations o WHERE o.server_id=? AND o.online=1 AND o.last_checked=? AND NOT EXISTS(SELECT 1 FROM player_sessions s WHERE s.server_id=o.server_id AND s.profile_id=o.profile_id AND s.ended_at IS NULL)').run(server.workspace_id,now,now,!previous?'baseline':continuous?'appeared':'resumed',server.id,now);
 await db.prepare('INSERT INTO player_presence_checks(server_id,workspace_id,checked_at,connected) VALUES(?,?,?,1) ON CONFLICT(server_id) DO UPDATE SET checked_at=excluded.checked_at,connected=1').run(server.id,server.workspace_id,now);
}

export async function interruptPlayerSessions(db,server,reason='connection_lost',now=Date.now()){
 return db.transaction(async()=>{
  if(!await db.prepare('SELECT id FROM workspaces WHERE id=? AND closed_at IS NULL FOR KEY SHARE').get(server.workspace_id))return;
  if(!await db.prepare('SELECT id FROM servers WHERE id=? AND workspace_id=? FOR UPDATE').get(server.id,server.workspace_id))return;
  await db.prepare(closeSql).run(now,reason,server.id);
  await db.prepare('UPDATE player_observations SET online=0 WHERE server_id=?').run(server.id);
  await db.prepare('INSERT INTO player_presence_checks(server_id,workspace_id,checked_at,connected) VALUES(?,?,?,0) ON CONFLICT(server_id) DO UPDATE SET checked_at=GREATEST(player_presence_checks.checked_at,excluded.checked_at),connected=0').run(server.id,server.workspace_id,now);
 });
}

export async function recoverPlayerActivity(db,now=Date.now()){
 await db.transaction(async()=>{
  await db.prepare("UPDATE player_sessions SET ended_at=last_seen,end_detected_at=GREATEST(last_seen,?),end_reason='monitoring_restarted' WHERE ended_at IS NULL").run(now);
  await db.prepare('UPDATE player_presence_checks SET connected=0,checked_at=GREATEST(checked_at,?)').run(now);
  await db.prepare('UPDATE player_observations SET online=0').run();
 });
}
export async function prunePlayerActivity(db,ws,now=Date.now()){
 const active=await db.prepare('SELECT id FROM servers WHERE workspace_id=? ORDER BY created_at,id LIMIT ?').all(ws.id,effectivePlan(ws).servers),ids=JSON.stringify(active.map(s=>s.id));
 const cutoff=now-effectivePlan(ws).historyDays*DAY;
 await db.transaction(async()=>{
  await db.prepare("UPDATE player_sessions SET ended_at=last_seen,end_detected_at=GREATEST(last_seen,?),end_reason='monitoring_paused' WHERE workspace_id=? AND ended_at IS NULL AND server_id NOT IN(SELECT json_array_elements_text(?::json))").run(now,ws.id,ids);
  await db.prepare('UPDATE player_presence_checks SET connected=0 WHERE workspace_id=? AND server_id NOT IN(SELECT json_array_elements_text(?::json))').run(ws.id,ids);
  await db.prepare('DELETE FROM player_sessions WHERE workspace_id=? AND ended_at IS NOT NULL AND last_seen<?').run(ws.id,cutoff);
 });
}

const querySchema=z.object({search:z.string().trim().max(140).default(''),game:z.enum(['all','asa','ase','minecraft','dayz']).default('all'),server_id:z.union([z.literal(''),z.string().uuid()]).default(''),profile_id:z.union([z.literal(''),z.string().uuid()]).default(''),state:z.enum(['all','active','closed','interrupted']).default('all'),sort:z.enum(['recent','longest','name']).default('recent'),days:z.coerce.number().int().refine(n=>[1,2,7,30].includes(n)).default(7),page:z.coerce.number().int().min(1).max(10000).default(1)}).strict();
const orders={recent:'last_seen DESC,id',longest:'observed_ms DESC,last_seen DESC,id',name:'LOWER(name),last_seen DESC,id'};
export function createPlayerActivity(db){
 async function query(workspace,input,scope,now){
  const value=querySchema.parse(input),ws=await db.prepare('SELECT * FROM workspaces WHERE id=? AND closed_at IS NULL').get(workspace);if(!ws)fail('Workspace not found.');
  const servers=await db.prepare('SELECT id FROM servers WHERE workspace_id=? ORDER BY created_at,id LIMIT ?').all(workspace,effectivePlan(ws).servers),active=JSON.stringify(servers.map(s=>s.id)),visible=scope===null?null:JSON.stringify(scope);
  if(value.server_id&&(!scope?.includes(value.server_id)&&scope!==null||!await db.prepare('SELECT id FROM servers WHERE id=? AND workspace_id=?').get(value.server_id,workspace)))fail('Server not found.');
  if(value.profile_id&&!await db.prepare('SELECT p.id FROM player_profiles p JOIN player_observations o ON o.profile_id=p.id WHERE p.workspace_id=? AND p.id=? AND (?::text IS NULL OR o.server_id IN(SELECT json_array_elements_text(?::json))) LIMIT 1').get(workspace,value.profile_id,visible,visible))fail('Player profile not found.');
  const days=Math.min(value.days,effectivePlan(ws).historyDays),cutoff=now-days*DAY,term='%'+value.search.replace(/[\\%_]/g,'\\$&')+'%';
  const cte=`WITH visible AS (SELECT s.id,s.profile_id,p.identity_key,p.identity_kind,p.game,s.server_id,g.name AS server_name,s.display_name AS name,GREATEST(s.started_at,?) AS started_at,s.started_at<? AS started_before_window,s.last_seen,s.ended_at,s.end_detected_at,s.samples,s.start_reason,s.end_reason,GREATEST(0,s.last_seen-GREATEST(s.started_at,?)) AS observed_ms,(s.ended_at IS NULL AND s.last_seen>=? AND c.connected=1 AND g.status='online' AND g.game=p.game AND s.server_id IN(SELECT json_array_elements_text(?::json))) AS current FROM player_sessions s JOIN player_profiles p ON p.id=s.profile_id JOIN servers g ON g.id=s.server_id LEFT JOIN player_presence_checks c ON c.server_id=s.server_id WHERE s.workspace_id=? AND s.last_seen>=? AND (?::text IS NULL OR s.server_id IN(SELECT json_array_elements_text(?::json))) AND (?='' OR s.server_id=?) AND (?='' OR s.profile_id=?) AND (?='all' OR p.game=?) AND (s.display_name ILIKE ? ESCAPE '\\' OR p.identity_key ILIKE ? ESCAPE '\\')),filtered AS (SELECT * FROM visible WHERE ?='all' OR (?='active' AND current) OR (?='closed' AND NOT current) OR (?='interrupted' AND end_reason IS NOT NULL AND end_reason<>'not_seen')) `;
  return{cte,params:[cutoff,cutoff,cutoff,now-PRESENCE_GAP_MS,active,workspace,cutoff,visible,visible,value.server_id,value.server_id,value.profile_id,value.profile_id,value.game,value.game,term,term,value.state,value.state,value.state,value.state],value,days,cutoff,retention_days:effectivePlan(ws).historyDays};
 }
 const serialize=row=>{const {identity_key,...item}=row;const identity=identityFromKey(identity_key);return{...item,identifier:identity.display,current:Boolean(row.current),started_before_window:Boolean(row.started_before_window)};};
 return{
  async list(workspace,input={},scope=null,now=Date.now()){
   const q=await query(workspace,input,scope,now),{cte,params,value}=q;
   const summary=await db.prepare(cte+"SELECT count(*) AS session_count,count(DISTINCT profile_id) AS unique_players,COALESCE(sum(observed_ms),0) AS observed_ms,count(DISTINCT profile_id) FILTER(WHERE current) AS current_players,count(*) FILTER(WHERE start_reason='appeared' AND NOT started_before_window) AS appearances,count(*) FILTER(WHERE end_reason='not_seen') AS disappearances,count(*) FILTER(WHERE end_reason IS NOT NULL AND end_reason<>'not_seen') AS interruptions FROM filtered").get(...params);
   const items=(await db.prepare(cte+'SELECT * FROM filtered ORDER BY '+orders[value.sort]+' LIMIT 25 OFFSET ?').all(...params,(value.page-1)*25)).map(serialize);
   const leaders=(await db.prepare(cte+'SELECT profile_id,identity_key,identity_kind,game,(array_agg(name ORDER BY last_seen DESC,id))[1] AS name,sum(observed_ms) AS observed_ms,count(*) AS sessions,MAX(last_seen) AS last_seen FROM filtered GROUP BY profile_id,identity_key,identity_kind,game ORDER BY observed_ms DESC,last_seen DESC,profile_id LIMIT 8').all(...params)).map(serialize);
   const events=(await db.prepare(cte+"SELECT * FROM (SELECT id||':start' AS event_id,profile_id,identity_key,identity_kind,game,name,server_id,server_name,started_at AS observed_at,start_reason AS kind FROM filtered WHERE NOT started_before_window UNION ALL SELECT id||':end',profile_id,identity_key,identity_kind,game,name,server_id,server_name,end_detected_at,end_reason FROM filtered WHERE end_detected_at>=?) events ORDER BY observed_at DESC,event_id LIMIT 30").all(...params,q.cutoff)).map(serialize);
   return{items,leaders,events,summary,page:value.page,page_size:25,total:summary.session_count,has_more:value.page*25<summary.session_count,days:q.days,cutoff:q.cutoff,retention_days:q.retention_days,generated_at:now};
  },
  async export(workspace,input={},scope=null,now=Date.now()){
   const q=await query(workspace,input,scope,now),rows=await db.prepare(q.cte+'SELECT * FROM filtered ORDER BY '+orders[q.value.sort]+' LIMIT 5001').all(...q.params);
   return{csv:playerSessionsCsv(rows.slice(0,5000).map(serialize)),filename:'rookrift-player-sessions-'+new Date(now).toISOString().slice(0,10)+'.csv',truncated:rows.length>5000};
  }
 };
}
