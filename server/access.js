const deny=()=>{throw Object.assign(new Error('Your role does not permit this action.'),{status:403});};
const missing=()=>{throw Object.assign(new Error('Record not found.'),{status:404});};
export function canSeeServer(access,id){return access.server_ids===null||access.server_ids.includes(id);}
export function authorizeRequest(db,req){
  const {access,workspace}=req,path=req.path,method=req.method;
  if(access.role==='owner')return;
  const admin=access.role==='admin',write=admin||access.role==='moderator';
  const server=id=>{if(typeof id!=='string'||!canSeeServer(access,id)||!db.prepare('SELECT id FROM servers WHERE id=? AND workspace_id=?').get(id,workspace.id))missing();};
  const record=(table,id)=>{const row=db.prepare(`SELECT * FROM ${table} WHERE id=? AND workspace_id=?`).get(id,workspace.id);if(!row)missing();return row;};
  if(method==='POST'&&['/logout','/workspaces/switch','/team/invitations/preview','/team/invitations/accept','/ban-directory/search'].includes(path))return;
  if(method==='GET'&&['/bootstrap','/workspaces','/ban-directory/bans','/player-profiles'].includes(path))return;
  if(/^\/player-profiles\/[^/]+(?:\/notes(?:\/[^/]+)?)?$/.test(path)){if(method==='GET'||write)return;deny();}
  if(path==='/analytics'&&method==='GET'){server(req.query.server_id);return;}
  let match=path.match(/^\/servers\/([^/]+)(?:\/(actions|hosting)(?:\/(actions))?)?$/);
  if(path==='/servers'&&method==='POST'){if(admin&&access.server_ids===null)return;deny();}
  if(path==='/servers/bulk-actions'&&method==='POST'){if(!write)deny();if(!Array.isArray(req.body?.server_ids))deny();req.body.server_ids.forEach(server);return;}
  if(match){server(match[1]);if(match[2]==='actions'){if(write)return;deny();}if(admin)return;deny();}
  match=path.match(/^\/schedules\/([^/]+)(?:\/(run|history))?$/);
  if(match){const row=record('schedules',match[1]);server(row.server_id);if(req.body?.server_id)server(req.body.server_id);if(method==='GET'&&match[2]==='history')return;if(admin)return;deny();}
  if(path==='/schedules'&&method==='POST'){if(!admin)deny();server(req.body?.server_id);return;}
  if(path==='/moderation'&&method==='POST'){if(!write)deny();server(req.body?.server_id);return;}
  if(/^\/incidents\/[^/]+$/.test(path)&&method==='PATCH'){if(!write)deny();server(record('incidents',path.split('/')[2]).server_id);return;}
  if(/^\/templates(?:\/[^/]+(?:\/send)?)?$/.test(path)){if(admin&&access.server_ids===null)return;deny();}
  match=path.match(/^\/maintenance-windows(?:\/([^/]+))?$/);
  if(match){if(!admin)deny();if(match[1])JSON.parse(record('maintenance_windows',match[1]).server_ids).forEach(server);if(req.body?.server_ids){if(!Array.isArray(req.body.server_ids))deny();req.body.server_ids.forEach(server);}return;}
  deny();
}
