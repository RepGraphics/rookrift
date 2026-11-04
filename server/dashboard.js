import {listServers,publicServer,playerSnapshot} from './db.js';
import {effectivePlan,PLANS} from './plans.js';
import {GAMES} from './games.js';
import {maintenanceState} from './operations-state.js';
import {canSeeServer} from './access.js';
export function buildDashboard({db,req,operations,banDirectory,team,billing,bot,env}){
  const ws=req.workspace,access=req.access,owner=access.role==='owner',plan=effectivePlan(ws);
  const all=listServers(db,ws.id),servers=all.map((server,index)=>({...server,...maintenanceState(db,server),paused:index>=plan.servers})).filter(server=>canSeeServer(access,server.id));
  const visible=new Set(servers.map(s=>s.id)),serverJson=JSON.stringify([...visible]);
  const schedules=db.prepare('SELECT * FROM schedules WHERE workspace_id=? ORDER BY rowid').all(ws.id).map((row,index)=>({...row,paused:index>=plan.schedules||!all.slice(0,plan.servers).some(s=>s.id===row.server_id)})).filter(row=>visible.has(row.server_id));
  const history=db.prepare('SELECT CAST(created_at/3600000 AS INTEGER)*3600000 AS time,SUM(players) AS players,COUNT(*) AS samples FROM metrics WHERE server_id IN(SELECT value FROM json_each(?)) AND created_at>? GROUP BY time ORDER BY time').all(serverJson,Date.now()-86400000);
  const uptime=db.prepare('SELECT AVG(online)*100 AS value FROM metrics WHERE server_id IN(SELECT value FROM json_each(?)) AND created_at>?').get(serverJson,Date.now()-86400000).value;
  const activeCount=Math.max(1,servers.filter(s=>!s.paused).length),chart=history.map(h=>({time:h.time,players:Math.round(h.players/Math.max(1,h.samples/activeCount))}));
  const activity=db.prepare('SELECT * FROM activity WHERE workspace_id=? AND (?=1 OR server_id IN(SELECT value FROM json_each(?))) ORDER BY created_at DESC LIMIT 100').all(ws.id,Number(owner),serverJson);
  const invite=owner&&env.DISCORD_CLIENT_ID?`https://discord.com/oauth2/authorize?${new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,scope:'bot applications.commands',permissions:'19456',integration_type:'0'})}`:null;
  const scoped=rows=>rows.filter(row=>visible.has(row.server_id));
  return{user:req.user,workspace:{id:ws.id,name:ws.name,plan:plan.id,subscription_status:ws.subscription_status,hasBillingAccount:owner&&Boolean(ws.customer_id),guild_id:owner?ws.guild_id:null,guild_name:owner?ws.guild_name:null,alert_channel_id:owner?ws.alert_channel_id:null,alerts_enabled:owner&&Boolean(ws.alerts_enabled),failure_threshold:owner?ws.failure_threshold:null},access,workspaces:team.listWorkspaces(req.auth.user_id),servers:servers.map(s=>publicServer(s,s.paused)),players:playerSnapshot(servers),schedules,activity,templates:access.server_ids===null?operations.listTemplates(ws.id):[],windows:operations.windows(ws.id).filter(window=>window.server_ids.every(id=>visible.has(id))),incidents:scoped(operations.incidents(ws.id)),notifications:owner?operations.notifications(ws.id):{items:[],unread:0},moderation:scoped(operations.moderation(ws.id)),hosting_links:['owner','admin'].includes(access.role)?scoped(operations.hostingLinks(ws.id)):[],ban_directory:owner?banDirectory.preferences(ws.id):{sharing_enabled:false,public_name:ws.name},metrics:{history:chart,uptime},plans:Object.values(PLANS),games:Object.values(GAMES),csrf:req.auth.csrf,integrations:{discord:Boolean(bot?.isReady()),billing:owner&&billing.ready,invite}};
}
