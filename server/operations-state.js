import { randomUUID } from 'node:crypto';
import { effectivePlan } from './plans.js';
import { windowActive } from '../shared/operations.js';
export { renderAnnouncement } from '../shared/operations.js';
export function listWindows(db, workspaceId) {
  const workspace = db.prepare('SELECT * FROM workspaces WHERE id=?').get(workspaceId);
  return db.prepare('SELECT * FROM maintenance_windows WHERE workspace_id=? ORDER BY created_at,id').all(workspaceId).map((row,index) => ({ ...row, server_ids: JSON.parse(row.server_ids), days: JSON.parse(row.days), enabled: Boolean(row.enabled), paused: index >= effectivePlan(workspace).windows }));
}
export function maintenanceState(db, server, now = Date.now()) {
  const windows = listWindows(db, server.workspace_id).filter(window => window.server_ids.includes(server.id) && windowActive(window,now));
  return { in_maintenance: Boolean(server.maintenance) || windows.length > 0, maintenance_windows: windows.map(window => ({ id:window.id,name:window.name })) };
}
export function notify(db, workspace, title, detail, level = 'info', target = 'incidents', key = null) {
  db.prepare('INSERT OR IGNORE INTO notifications VALUES(?,?,?,?,?,?,?,?,NULL)').run(randomUUID(),workspace,title,detail.slice(0,1000),level,target,key,Date.now());
}
export async function observeHealth(db, workspace, server, send, now = Date.now()) {
  const maintenance = maintenanceState(db,server,now).in_maintenance;
  const open = db.prepare('SELECT * FROM incidents WHERE server_id=? AND resolved_at IS NULL').get(server.id);
  if (server.status === 'online') {
    db.prepare('UPDATE servers SET failed_checks=0,failed_since=NULL WHERE id=?').run(server.id);
    if (open) {
      db.prepare('UPDATE incidents SET resolved_at=? WHERE id=?').run(now,open.id);
      notify(db,workspace.id,'Server recovered',server.name,'success','incidents',`${open.id}:recovered`);
      if (workspace.alerts_enabled && !maintenance) await send(workspace,`Server back online: ${server.name}`).catch(()=>{});
    }
  } else if (server.status === 'offline') {
    if(maintenance){db.prepare('UPDATE servers SET failed_checks=0,failed_since=NULL WHERE id=?').run(server.id);return;}
    const count = server.failed_checks + 1;
    const since = server.failed_since || now;
    db.prepare('UPDATE servers SET failed_checks=?,failed_since=? WHERE id=?').run(count,since,server.id);
    if (!maintenance && !open && count >= workspace.failure_threshold) {
      const id=randomUUID(); db.prepare("INSERT INTO incidents(id,workspace_id,server_id,opened_at) VALUES(?,?,?,?)").run(id,workspace.id,server.id,since);
      notify(db,workspace.id,'RCON outage detected',`${server.name} · ${count} failed checks`,'error','incidents',`${id}:opened`);
      if (workspace.alerts_enabled) await send(workspace,`Server went offline: ${server.name}`).catch(()=>{});
    }
  }
}
