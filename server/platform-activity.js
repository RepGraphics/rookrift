import {randomUUID} from 'node:crypto';
const retention=90*24*60*60*1000;
// Callers supply fixed action names and field names, never form values or secrets.
export async function recordPlatformActivity(db,user,action,{targetUser=null,targetWorkspace=null,detail=''}={}){
 if(!user?.platform_admin)throw Object.assign(new Error('Platform administrator access required.'),{status:403});
 await db.prepare('DELETE FROM platform_activity WHERE created_at<?').run(Date.now()-retention);
 await db.prepare('INSERT INTO platform_activity(id,actor_id,target_user_id,target_workspace_id,action,detail,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),user.id,targetUser,targetWorkspace,action,detail,Date.now());
}
export async function platformActivity(db,user){
 if(!user?.platform_admin)throw Object.assign(new Error('Platform administrator access required.'),{status:403});
 await db.prepare('DELETE FROM platform_activity WHERE created_at<?').run(Date.now()-retention);
 return db.prepare(`SELECT p.id,p.action,p.detail,p.created_at,coalesce(a.name,'Deleted administrator') AS actor_name,
 coalesce(u.name,w.name,CASE WHEN p.target_user_id IS NULL AND p.target_workspace_id IS NULL THEN 'Platform / removed target' END) AS target_name
 FROM platform_activity p LEFT JOIN users a ON a.id=p.actor_id LEFT JOIN users u ON u.id=p.target_user_id
 LEFT JOIN workspaces w ON w.id=p.target_workspace_id ORDER BY p.created_at DESC,p.id DESC LIMIT 100`).all();
}
