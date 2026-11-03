import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertCapacity, assertServerEntitled, effectivePlan } from './plans.js';
import { audit, listServers, publicServer } from './db.js';
import { runRcon } from './games.js';
export const serverSchema = z.object({
  name: z.string().trim().min(2).max(60), game: z.enum(['asa', 'ase']), map: z.string().trim().min(1).max(60),
  host: z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.:-]+$/, 'Enter a hostname or IP address without a URL or port.'),
  port: z.coerce.number().int().min(1).max(65535), password: z.string().min(1).max(200), max_players: z.coerce.number().int().min(1).max(1000).default(70)
});
export const scheduleSchema = z.object({
  server_id: z.string().uuid(), name: z.string().trim().min(2).max(60), action: z.enum(['save', 'broadcast']),
  message: z.string().trim().max(300).default(''), interval_minutes: z.coerce.number().int().min(15).max(10080)
}).refine(data => data.action !== 'broadcast' || data.message.length > 0, { message: 'Broadcast message is required.' });
export function createService(db, vault, transport = runRcon) {
  const busy = new Set();
  const workspace = id => db.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
  function getServer(workspaceId, serverId, enforce = true) {
    const servers = listServers(db, workspaceId), server = servers.find(s => s.id === serverId);
    if (!server) throw Object.assign(new Error('Server not found.'), { status: 404 });
    if (enforce) assertServerEntitled(workspace(workspaceId), servers, serverId);
    return server;
  }
  return {
    getServer,
    addServer(workspaceId, input) {
      const data = serverSchema.parse(input);
      // No await between counting and insertion: SQLite access is serialized in this process.
      assertCapacity(workspace(workspaceId), listServers(db, workspaceId).length);
      const id = randomUUID();
      db.prepare('INSERT INTO servers(id,workspace_id,name,game,map,host,port,password,max_players,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, workspaceId, data.name, data.game, data.map, data.host, data.port, vault.encrypt(data.password), data.max_players, Date.now());
      audit(db, workspaceId, 'Server connected', `${data.name} added. Awaiting first RCON check.`, 'info', id);
      return publicServer(getServer(workspaceId, id));
    },
    addSchedule(workspaceId, input) {
      const data = scheduleSchema.parse(input), ws = workspace(workspaceId);
      getServer(workspaceId, data.server_id);
      assertCapacity(ws, db.prepare('SELECT count(*) AS n FROM schedules WHERE workspace_id=?').get(workspaceId).n, 'schedules');
      const id = randomUUID();
      db.prepare('INSERT INTO schedules VALUES(?,?,?,?,?,?,?,?,1)').run(id, workspaceId, data.server_id, data.name, data.action, data.message, data.interval_minutes, Date.now() + data.interval_minutes * 60000);
      audit(db, workspaceId, 'Automation created', data.name);
      return db.prepare('SELECT * FROM schedules WHERE id=?').get(id);
    },
    async action(workspaceId, serverId, action, message, actor = 'Dashboard') {
      const server = getServer(workspaceId, serverId);
      if (busy.has(serverId)) throw Object.assign(new Error('Another command is running on this server. Try again shortly.'), { status: 409 });
      busy.add(serverId);
      try {
        const result = await transport(server, vault, action, message);
        if (result.players) db.prepare('UPDATE servers SET status=?,players=?,latency=?,last_checked=? WHERE id=?').run('online', result.players.length, result.latency, Date.now(), serverId);
        if (action !== 'status') audit(db, workspaceId, ({ save: 'World saved', broadcast: 'Broadcast sent', players: 'Player list requested' })[action] || action, `${server.name} · ${actor}`, 'success', serverId);
        return result;
      } catch (error) {
        if (!error.status) { db.prepare('UPDATE servers SET status=?,last_checked=? WHERE id=?').run('offline', Date.now(), serverId); error.status = 502; error.message = 'RCON connection failed. Check the address, port, password, and firewall.'; }
        if (action !== 'status') audit(db, workspaceId, 'Command failed', `${server.name} · ${error.message}`, 'error', serverId);
        throw error;
      } finally { busy.delete(serverId); }
    },
    async pollAll(notify = async () => {}) {
      for (const ws of db.prepare('SELECT * FROM workspaces').all()) {
        for (const server of listServers(db, ws.id).slice(0, effectivePlan(ws).servers)) {
          try { await this.action(ws.id, server.id, 'status'); } catch (error) { if (error.status === 409) continue; }
          const updated = getServer(ws.id, server.id);
          db.prepare('INSERT INTO metrics VALUES(?,?,?,?)').run(server.id, updated.players, updated.status === 'online' ? 1 : 0, Date.now());
          if (server.status !== 'unknown' && server.status !== updated.status) {
            const title = updated.status === 'online' ? 'Server back online' : 'Server went offline';
            audit(db, ws.id, title, server.name, updated.status === 'online' ? 'success' : 'error', server.id);
            await notify(ws, `${title}: ${server.name}`).catch(() => {});
          }
        }
        const cutoff = Date.now() - effectivePlan(ws).historyDays * 86400000;
        db.prepare('DELETE FROM activity WHERE workspace_id=? AND created_at<?').run(ws.id, cutoff);
        db.prepare('DELETE FROM metrics WHERE server_id IN (SELECT id FROM servers WHERE workspace_id=?) AND created_at<?').run(ws.id, cutoff);
      }
    },
    async runDueSchedules() {
      for (const ws of db.prepare('SELECT * FROM workspaces').all()) {
        const schedules = db.prepare('SELECT * FROM schedules WHERE workspace_id=? ORDER BY rowid').all(ws.id).slice(0, effectivePlan(ws).schedules);
        for (const task of schedules.filter(s => s.enabled && s.next_run <= Date.now())) {
          // Claim before execution. Restarted processes never repeat a claimed task.
          const result = db.prepare('UPDATE schedules SET next_run=? WHERE id=? AND next_run=?').run(Date.now() + task.interval_minutes * 60000, task.id, task.next_run);
          if (!result.changes) continue;
          try { await this.action(ws.id, task.server_id, task.action, task.message, `Automation: ${task.name}`); } catch { /* action records failures; no unsafe automatic retries */ }
        }
      }
    }
  };
}
