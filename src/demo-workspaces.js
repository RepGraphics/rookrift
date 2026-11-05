import {demoSeed,upgradeDemo} from './demo';
const globals=new Set(['user','plans','workspaces','workspace_snapshots']);
const snapshot=data=>structuredClone(Object.fromEntries(Object.entries(data).filter(([key])=>!globals.has(key))));
export function switchDemoWorkspace(data,id){
 if(id===data.workspace.id)return data;
 const next=structuredClone(data),list=next.workspaces||[],target=list.find(ws=>ws.id===id);if(!target)throw new Error('Workspace not available.');
 next.workspace_snapshots??={};next.workspace_snapshots[next.workspace.id]=snapshot(next);const saved=next.workspace_snapshots[id];if(!saved)throw new Error('Workspace data is unavailable.');
 for(const key of Object.keys(next))if(!globals.has(key))delete next[key];Object.assign(next,structuredClone(saved));return upgradeDemo(next);
}
export function createDemoWorkspace(data,input){
 if((data.workspaces||[]).filter(w=>w.role==='owner').length>=10)throw new Error('You can own up to 10 workspaces.');
 if(data.workspaces.some(w=>w.role==='owner'&&w.name.toLowerCase()===input.name.trim().toLowerCase()))throw new Error('Choose a different workspace name.');
 const next=structuredClone(data),id=crypto.randomUUID();next.workspace_snapshots??={};next.workspace_snapshots[next.workspace.id]=snapshot(next);
 const fresh=structuredClone(demoSeed);fresh.workspace={id,name:input.name.trim(),game_focus:input.game_focus,plan:'scout',subscription_status:'free',hasBillingAccount:false,guild_id:null,guild_name:null,alerts_enabled:false};fresh.servers=[];fresh.schedules=[];fresh.activity=[];fresh.metrics={uptime:null,history:[]};fresh.players=[];fresh.team={members:[],invitations:[],audit:[]};fresh.templates=[];fresh.windows=[];fresh.host_resources={};fresh.backups={};upgradeDemo(fresh);fresh.community.site.enabled=false;fresh.community.site.slug='workspace-'+id.slice(0,8);fresh.community.posts=[];fresh.community.events=[];fresh.community.applications=[];fresh.community.rsvps=[];
 const list=[...next.workspaces,{id,name:fresh.workspace.name,game_focus:input.game_focus,role:'owner',server_ids:null}];for(const key of Object.keys(next))if(!globals.has(key))delete next[key];Object.assign(next,snapshot(fresh),{workspaces:list});return next;
}
