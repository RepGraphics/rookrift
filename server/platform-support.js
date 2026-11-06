import {effectivePlan} from './plans.js';
const fail=(message,status)=>{throw Object.assign(new Error(message),{status});};
export function createPlatformSupport(db){return{
 async workspace(actor,id){
  if(!actor?.platform_admin)fail('Platform administrator access required.',403);
  return db.transaction(async()=>{
   const ws=await db.prepare('SELECT id,name,plan,subscription_status FROM workspaces WHERE id=? AND closed_at IS NULL FOR KEY SHARE').get(id);if(!ws)fail('Workspace not found.',404);
   const limit=effectivePlan(ws).servers,servers=await db.prepare('SELECT id,name,game,map,status,players,max_players,last_checked,maintenance FROM servers WHERE workspace_id=? ORDER BY created_at,id').all(id);
   const delivery=await db.prepare('SELECT status,count(*) AS count FROM store_delivery_jobs WHERE workspace_id=? GROUP BY status ORDER BY status').all(id);
   const orders=await db.prepare('SELECT payment_status,fulfillment_status,count(*) AS count FROM store_orders WHERE workspace_id=? GROUP BY payment_status,fulfillment_status ORDER BY payment_status,fulfillment_status').all(id);
   const workflows=await db.prepare('SELECT status,count(*) AS count FROM workflow_runs WHERE workspace_id=? GROUP BY status ORDER BY status').all(id);
   const incidents=await db.prepare('SELECT count(*) AS open,count(*) FILTER(WHERE acknowledged_at IS NULL) AS unacknowledged FROM incidents WHERE workspace_id=? AND resolved_at IS NULL').get(id);
   const team=await db.prepare('SELECT role,count(*) AS count FROM workspace_members WHERE workspace_id=? GROUP BY role ORDER BY role').all(id);
   const community=await db.prepare('SELECT slug,title,enabled,join_requests_open,staff_applications_open FROM community_sites WHERE workspace_id=?').get(id)||null;
   const store=await db.prepare('SELECT enabled,payment_provider FROM community_stores WHERE workspace_id=?').get(id)||null;
   return{generated_at:Date.now(),workspace:ws,server_limit:limit,servers:servers.map((s,index)=>({...s,paused:index>=limit})),incidents,delivery,orders,workflows,team,community,store};
  });
 }
};}
