import { PLANS } from '../server/plans.js';
const now = Date.now();
export const demoSeed = {
  user: { id: 'demo', name: 'Alex Morgan' },
  workspace: { id: 'demo', name: 'The Outpost', plan: 'tribe', subscription_status: 'active', hasBillingAccount: false, guild_id: '123456789012345678', guild_name: 'The Outpost', alert_channel_id: '123456789012345679', alerts_enabled: true },
  integrations: { discord: true, billing: false, invite: null },
  plans: Object.values(PLANS),
  servers: [
    { id: 'd1', name: 'The Island · PvE', game: 'asa', map: 'The Island', host: 'island.example.com', port: 27020, max_players: 70, players: 32, latency: 24, status: 'online', created_at: now - 9000000 },
    { id: 'd2', name: 'Scorched Earth · PvP', game: 'asa', map: 'Scorched Earth', host: 'scorched.example.com', port: 27020, max_players: 70, players: 18, latency: 31, status: 'online', created_at: now - 8000000 },
    { id: 'd3', name: 'Ragnarok · PvE', game: 'ase', map: 'Ragnarok', host: 'ragnarok.example.com', port: 27020, max_players: 70, players: 0, latency: null, status: 'offline', created_at: now - 7000000 }
  ],
  schedules: [
    { id: 't1', name: 'Keep the world safe', server_id: 'd1', action: 'save', message: '', interval_minutes: 60, next_run: now + 2400000, enabled: 1 },
    { id: 't2', name: 'Community reminder', server_id: 'd2', action: 'broadcast', message: 'Join our Discord community for news and events!', interval_minutes: 120, next_run: now + 5400000, enabled: 1 }
  ],
  activity: [
    { id: 'a1', title: 'World saved', detail: 'The Island · PvE · Scheduled save', level: 'success', created_at: now - 120000 },
    { id: 'a2', title: 'Server went offline', detail: 'Ragnarok · PvE · RCON connection lost', level: 'error', created_at: now - 840000 },
    { id: 'a3', title: 'Broadcast sent', detail: 'Scorched Earth · PvP · Community reminder', level: 'info', created_at: now - 1800000 },
    { id: 'a4', title: 'Server connected', detail: 'Scorched Earth · PvP added to your workspace', level: 'success', created_at: now - 3600000 }
  ],
  metrics: { uptime: 98.7, history: [19, 17, 16, 20, 25, 23, 31, 27, 22, 28, 34, 31, 32, 38, 42, 37, 44, 41, 50, 45, 48, 43, 53, 50].map((players, i) => ({ time: now - (23 - i) * 3600000, players })) }
};
export function loadDemo() {
  try { const saved = JSON.parse(localStorage.getItem('rookrift-demo-v1')); if (saved?.workspace && Array.isArray(saved.servers) && Array.isArray(saved.activity)) return upgradeDemo(saved); } catch { /* storage may be unavailable */ }
  return upgradeDemo(structuredClone(demoSeed));
}
export function storeDemo(data) { try { localStorage.setItem('rookrift-demo-v1', JSON.stringify(data)); } catch { /* continue with in-memory demo */ } }
function demoPlayers(servers) {
  const names = ['RidgeRunner', 'AshWalker', 'Nora', 'StoneFox', 'Ember', 'Kestrel', 'Moss', 'RiverScout', 'Skye', 'Atlas'];
  return servers.filter(server => server.status === 'online').flatMap(server => Array.from({ length: server.players }, (_, index) => ({ id: `${server.id}:${index}`, name: `${names[index % names.length]}${index >= names.length ? index + 1 : ''}`, identifier: `DEMO-${server.id.toUpperCase()}-${String(index + 1).padStart(3, '0')}`, server_id: server.id, server_name: server.name, game: server.game, cluster: server.cluster, checked_at: now })));
}
export function upgradeDemo(data) {
  data.workspace.alerts_enabled ??= true;
  data.workspace.failure_threshold ??= 1;
  data.servers = data.servers.map(server => ({ ...server, cluster: server.cluster ?? (server.game === 'asa' ? 'Main cluster' : 'Legacy worlds'), maintenance: Boolean(server.maintenance), last_checked: server.last_checked ?? (server.status === 'unknown' ? null : now) }));
  data.players ??= demoPlayers(data.servers);
  data.schedules = (data.schedules || []).map(schedule => ({ ...schedule, last_run: schedule.last_run ?? null, last_status: schedule.last_status ?? null, last_detail: schedule.last_detail ?? null }));
  data.activity = data.activity.map(event => ({ ...event, server_id: event.server_id || (event.detail?.includes('The Island') ? 'd1' : event.detail?.includes('Scorched Earth') ? 'd2' : event.detail?.includes('Ragnarok') ? 'd3' : null) }));
  data.templates ??= [
    {id:'tpl-welcome',name:'Community welcome',body:'Welcome to {server}! Join our Discord for rules, events, and support.',created_at:now,updated_at:now},
    {id:'tpl-save',name:'World save notice',body:'{server} is saving shortly. {players} survivors are currently connected.',created_at:now+1,updated_at:now},
    {id:'tpl-event',name:'Weekend event',body:'Our weekend event is live on {map}. Check Discord for the details.',created_at:now+2,updated_at:now}
  ];
  data.windows ??= [{id:'mw-weekly',name:'Weekly upkeep',server_ids:['d1','d2'],days:[0],start_time:'04:00',duration_minutes:30,time_zone:'UTC',enabled:true,created_at:now}];
  data.incidents ??= data.servers.filter(server=>server.status==='offline').map(server=>({id:`incident-${server.id}`,server_id:server.id,server_name:server.name,opened_at:now-840000,resolved_at:null,acknowledged_at:null,notes:'Investigate the RCON connection and game host status.'}));
  data.notifications ??= {unread:data.incidents.length,items:data.incidents.map(incident=>({id:`notification-${incident.id}`,title:'RCON outage detected',detail:incident.server_name,level:'error',target:'incidents',created_at:incident.opened_at,read_at:null}))};
  data.moderation ??= [];
  data.hosting_links ??= data.servers.some(server=>server.id==='d1')?[{server_id:'d1',provider:'pterodactyl',origin:'https://panel.example.com',remote_id:'demo0001',verified_at:now}]:[];
  data.host_resources ??= {d1:{state:'running',cpu:14.2,memory_bytes:4*1024**3,disk_bytes:18*1024**3,uptime_ms:68400000}};
  data.backups ??= {d1:[{id:'backup-demo-1',name:'Daily world archive',bytes:840*1024**2,created_at:new Date(now-86400000).toISOString(),completed_at:new Date(now-86400000+60000).toISOString(),status:'completed'}]};
  data.runs ??= data.schedules.flatMap(task=>[{id:`run-${task.id}`,schedule_id:task.id,server_id:task.server_id,started_at:now-3600000,finished_at:now-3599000,status:'success',detail:'Simulated command acknowledged.'}]);
  return data;
}
export function demoHealth(server,hours=24) {
  const count=Math.min(96,hours*4),base=Date.now()-hours*3600000;
  const series=Array.from({length:count},(_,index)=>{const failed=server.status==='offline'&&index>count*.8;return {time:base+index*hours*3600000/count,players:failed?0:Math.max(0,Math.round(server.players*(.7+.3*Math.sin(index/5)))),availability:failed?0:100,latency:failed?null:Math.round(24+9*Math.sin(index/3)+index%5)};});
  const latencies=series.filter(point=>point.latency!=null).map(point=>point.latency).sort((a,b)=>a-b);
  return {hours,samples:hours*60,availability:series.reduce((sum,point)=>sum+point.availability,0)/count,p95_latency:latencies[Math.max(0,Math.ceil(latencies.length*.95)-1)]||null,peak_players:Math.max(...series.map(point=>point.players)),series,incidents:[]};
}
