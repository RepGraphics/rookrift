const deny = () => {
  throw Object.assign(new Error('Your role does not permit this action.'), {
    status: 403
  });
};
const missing = () => {
  throw Object.assign(new Error('Record not found.'), {
    status: 404
  });
};
export function canSeeServer(access, id) {
  return access.server_ids === null || access.server_ids.includes(id);
}
export async function authorizeRequest(db, req) {
  const {
      access,
      workspace
    } = req,
    path = req.path,
    method = req.method;
  if (access.role === 'owner') return;
  const admin = access.role === 'admin',
    write = admin || access.role === 'moderator';
  if(/^\/community(?:\/|$)/.test(path)){
    if(access.server_ids!==null)deny();
    if(/^\/community\/applications(?:\/[^/]+)?$/.test(path)){if(write&&['GET','PATCH'].includes(method))return;if(admin&&method==='DELETE')return;deny();}
    if(admin)return;
    deny();
  }
  const server = async id => {
    if (typeof id !== 'string' || !canSeeServer(access, id) || !(await db.prepare('SELECT id FROM servers WHERE id=? AND workspace_id=?').get(id, workspace.id))) missing();
  };
  const record = async (table, id) => {
    const row = await db.prepare(`SELECT * FROM ${table} WHERE id=? AND workspace_id=?`).get(id, workspace.id);
    if (!row) missing();
    return row;
  };
  if(path==='/workflows'){
    if(method==='GET')return;
    if(admin&&method==='POST'){await server(req.body?.server_id);return;}
    deny();
  }
  let workflowMatch=path.match(/^\/workflows\/([^/]+)(?:\/(run|toggle|webhook-key))?$/);
  if(path==='/config-templates'&&method==='GET')return;
  let configMatch=path.match(/^\/config-templates\/([^/]+)(?:\/(versions|preview|apply))?$/);
  if(configMatch){await record('config_templates',configMatch[1]);if(method==='GET'&&configMatch[2]==='versions')return;if(['preview','apply'].includes(configMatch[2])){if(!admin)deny();await server(req.body?.server_id);return;}if(admin&&access.server_ids===null)return;deny();}
  if(path==='/config-templates'&&method==='POST'){if(admin&&access.server_ids===null)return;deny();}
  configMatch=path.match(/^\/config-applications\/([^/]+)(?:\/(rollback|verify))?$/);
  if(configMatch){if(!admin)deny();await server((await record('config_applications',configMatch[1])).server_id);return;}
  if(workflowMatch){if(!admin)deny();await server((await record('workflows',workflowMatch[1])).server_id);if(req.body?.server_id)await server(req.body.server_id);return;}
  workflowMatch=path.match(/^\/workflow-runs\/([^/]+)\/cancel$/);
  if(workflowMatch){if(!admin)deny();await server((await record('workflow_runs',workflowMatch[1])).server_id);return;}
  workflowMatch=path.match(/^\/workflow-runs\/([^/]+)$/);
  if(workflowMatch&&method==='GET'){await server((await record('workflow_runs',workflowMatch[1])).server_id);return;}
  if (method === 'POST' && ['/logout', '/workspaces/switch', '/team/invitations/preview', '/team/invitations/accept', '/ban-directory/search'].includes(path)) return;
  if (method === 'GET' && ['/bootstrap', '/workspaces', '/ban-directory/bans', '/player-profiles'].includes(path)) return;
  if (/^\/player-profiles\/[^/]+(?:\/notes(?:\/[^/]+)?)?$/.test(path)) {
    if (method === 'GET' || write) return;
    deny();
  }
  if (path === '/analytics' && method === 'GET') {
    await server(req.query.server_id);
    return;
  }
  let match = path.match(/^\/servers\/([^/]+)(?:\/(actions|hosting)(?:\/(actions))?)?$/);
  if (path === '/servers' && method === 'POST') {
    if (admin && access.server_ids === null) return;
    deny();
  }
  if (path === '/servers/bulk-actions' && method === 'POST') {
    if (!write) deny();
    if (!Array.isArray(req.body?.server_ids)) deny();
    for (const _item of req.body.server_ids) {
      await server(_item);
    }
    return;
  }
  if (match) {
    await server(match[1]);
    if (match[2] === 'actions') {
      if (write) return;
      deny();
    }
    if (admin) return;
    deny();
  }
  match = path.match(/^\/schedules\/([^/]+)(?:\/(run|history))?$/);
  if (match) {
    const row = await record('schedules', match[1]);
    await server(row.server_id);
    if (req.body?.server_id) await server(req.body.server_id);
    if (method === 'GET' && match[2] === 'history') return;
    if (admin) return;
    deny();
  }
  if (path === '/schedules' && method === 'POST') {
    if (!admin) deny();
    await server(req.body?.server_id);
    return;
  }
  if (path === '/moderation' && method === 'POST') {
    if (!write) deny();
    await server(req.body?.server_id);
    return;
  }
  if (/^\/incidents\/[^/]+$/.test(path) && method === 'PATCH') {
    if (!write) deny();
    await server((await record('incidents', path.split('/')[2])).server_id);
    return;
  }
  if (/^\/templates(?:\/[^/]+(?:\/send)?)?$/.test(path)) {
    if (admin && access.server_ids === null) return;
    deny();
  }
  match = path.match(/^\/maintenance-windows(?:\/([^/]+))?$/);
  if (match) {
    if (!admin) deny();
    if (match[1]) for (const _item2 of JSON.parse((await record('maintenance_windows', match[1])).server_ids)) {
      await server(_item2);
    }
    if (req.body?.server_ids) {
      if (!Array.isArray(req.body.server_ids)) deny();
      for (const _item3 of req.body.server_ids) {
        await server(_item3);
      }
    }
    return;
  }
  deny();
}
