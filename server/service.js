import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertCapacity, assertServerEntitled, effectivePlan } from './plans.js';
import { audit, listServers, publicServer } from './db.js';
import { runRcon } from './games.js';
import { commandFor } from './games.js';
import { maintenanceState,renderAnnouncement,observeHealth,notify } from './operations-state.js';
const serverFields = z.object({
  name: z.string().trim().min(2).max(60), game: z.enum(['asa', 'ase']), map: z.string().trim().min(1).max(60),
  host: z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.:-]+$/, 'Enter a hostname or IP address without a URL or port.'),
  port: z.coerce.number().int().min(1).max(65535), password: z.string().min(1).max(200), max_players: z.coerce.number().int().min(1).max(1000),
  cluster: z.string().trim().max(40), notes:z.string().trim().max(2000)
});
export const serverSchema = serverFields.extend({ max_players: serverFields.shape.max_players.default(70), cluster: serverFields.shape.cluster.default(''),notes:serverFields.shape.notes.default('') }).strict();
export const serverUpdateSchema = serverFields.partial().extend({ password: z.string().max(200).optional(), maintenance: z.boolean().optional() }).strict();
export const scheduleSchema = z.object({
  server_id: z.string().uuid(), name: z.string().trim().min(2).max(60), action: z.enum(['save', 'broadcast']),
  message: z.string().trim().max(300).default(''), interval_minutes: z.coerce.number().int().min(15).max(10080)
}).strict().refine(data => data.action !== 'broadcast' || data.message.length > 0, { message: 'Broadcast message is required.' });
export const bulkSchema = z.object({
  server_ids: z.array(z.string().uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length, 'Choose each server once.'),
  action: z.enum(['status', 'save', 'broadcast']), message: z.string().trim().max(300).optional()
}).strict();
export function createService(db, vault, transport = runRcon) {
  const busy = new Set(), runningTasks = new Set();
  const workspace = id => db.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
  function getServer(workspaceId, serverId, enforce = true) {
    const servers = listServers(db, workspaceId), server = servers.find(s => s.id === serverId);
    if (!server) throw Object.assign(new Error('Server not found.'), { status: 404 });
    if (enforce) assertServerEntitled(workspace(workspaceId), servers, serverId);
    return server;
  }
  function getSchedule(workspaceId, id, enforce = true) {
    const schedules = db.prepare('SELECT * FROM schedules WHERE workspace_id=? ORDER BY rowid').all(workspaceId);
    const index = schedules.findIndex(task => task.id === id);
    if (index < 0) throw Object.assign(new Error('Automation not found.'), { status: 404 });
    if (enforce) {
      if (index >= effectivePlan(workspace(workspaceId)).schedules) throw Object.assign(new Error('This automation is paused by your current plan.'), { status: 403 });
      getServer(workspaceId, schedules[index].server_id);
    }
    return schedules[index];
  }
  return {
    getServer, getSchedule,
    addServer(workspaceId, input) {
      const data = serverSchema.parse(input);
      // No await between counting and insertion: SQLite access is serialized in this process.
      assertCapacity(workspace(workspaceId), listServers(db, workspaceId).length);
      const id = randomUUID();
      db.prepare('INSERT INTO servers(id,workspace_id,name,game,map,host,port,password,max_players,created_at,cluster,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, workspaceId, data.name, data.game, data.map, data.host, data.port, vault.encrypt(data.password), data.max_players, Date.now(), data.cluster,data.notes);
      audit(db, workspaceId, 'Server connected', `${data.name} added. Awaiting first RCON check.`, 'info', id);
      return publicServer(getServer(workspaceId, id));
    },
    updateServer(workspaceId, id, input) {
      const original = getServer(workspaceId, id, false), data = serverUpdateSchema.parse(input);
      if (busy.has(id)) throw Object.assign(new Error('Wait for the current server command to finish before editing its connection.'), { status: 409 });
      const connectionChanged = ['host', 'port', 'game'].some(key => data[key] !== undefined && data[key] !== original[key]) || Boolean(data.password);
      const updated = { ...original, ...data, password: data.password ? vault.encrypt(data.password) : original.password, maintenance: data.maintenance === undefined ? original.maintenance : Number(data.maintenance) };
      db.prepare('UPDATE servers SET name=?,game=?,map=?,host=?,port=?,password=?,max_players=?,cluster=?,maintenance=?,notes=? WHERE id=? AND workspace_id=?').run(updated.name, updated.game, updated.map, updated.host, updated.port, updated.password, updated.max_players, updated.cluster, updated.maintenance,updated.notes, id, workspaceId);
      if (connectionChanged) db.prepare("UPDATE servers SET status='unknown',players=0,latency=NULL,last_checked=NULL,player_list='[]',failed_checks=0,failed_since=NULL WHERE id=?").run(id);
      if (original.maintenance !== updated.maintenance) audit(db, workspaceId, updated.maintenance ? 'Maintenance enabled' : 'Maintenance ended', `${updated.name} · Scheduled tasks and connection alerts ${updated.maintenance ? 'paused' : 'resumed'}`, 'info', id);
      else audit(db, workspaceId, 'Server settings updated', updated.name, 'info', id);
      return publicServer(getServer(workspaceId, id, false));
    },
    addSchedule(workspaceId, input) {
      const data = scheduleSchema.parse(input), ws = workspace(workspaceId);
      getServer(workspaceId, data.server_id);
      assertCapacity(ws, db.prepare('SELECT count(*) AS n FROM schedules WHERE workspace_id=?').get(workspaceId).n, 'schedules');
      const id = randomUUID();
      db.prepare('INSERT INTO schedules(id,workspace_id,server_id,name,action,message,interval_minutes,next_run,enabled) VALUES(?,?,?,?,?,?,?,?,1)').run(id, workspaceId, data.server_id, data.name, data.action, data.message, data.interval_minutes, Date.now() + data.interval_minutes * 60000);
      audit(db, workspaceId, 'Automation created', data.name);
      return db.prepare('SELECT * FROM schedules WHERE id=?').get(id);
    },
    updateSchedule(workspaceId, id, input) {
      const original = getSchedule(workspaceId, id, false);
      if (runningTasks.has(id)) throw Object.assign(new Error('Wait for this automation to finish before editing it.'), { status: 409 });
      if (input && Object.keys(input).length === 1 && typeof input.enabled === 'boolean') {
        if (input.enabled) getSchedule(workspaceId, id);
        db.prepare('UPDATE schedules SET enabled=?,next_run=? WHERE id=?').run(Number(input.enabled), input.enabled ? Date.now() + original.interval_minutes * 60000 : original.next_run, id);
      } else {
        getSchedule(workspaceId, id);
        const data = scheduleSchema.parse(input); getServer(workspaceId, data.server_id);
        db.prepare('UPDATE schedules SET server_id=?,name=?,action=?,message=?,interval_minutes=?,next_run=? WHERE id=?').run(data.server_id, data.name, data.action, data.message, data.interval_minutes, Date.now() + data.interval_minutes * 60000, id);
      }
      audit(db, workspaceId, 'Automation updated', original.name);
      return getSchedule(workspaceId, id, false);
    },
    deleteSchedule(workspaceId,id) {
      const task=getSchedule(workspaceId,id,false);
      if(runningTasks.has(id))throw Object.assign(new Error('Wait for this automation to finish before deleting it.'),{status:409});
      db.prepare('DELETE FROM schedules WHERE id=? AND workspace_id=?').run(id,workspaceId);
      audit(db,workspaceId,'Automation removed',task.name);
    },
    async runSchedule(workspaceId, id, actor = 'Run now') {
      const task = getSchedule(workspaceId, id);
      const runId=randomUUID(),started=Date.now();
      const record=(status,detail)=>db.prepare('INSERT INTO schedule_runs VALUES(?,?,?,?,?,?,?,?)').run(runId,workspaceId,id,task.server_id,started,Date.now(),status,String(detail).slice(0,1000));
      if (runningTasks.has(id)) throw Object.assign(new Error('This automation is already running.'), { status: 409 });
      const server = getServer(workspaceId, task.server_id);
      if (maintenanceState(db,server).in_maintenance) {
        db.prepare("UPDATE schedules SET last_run=?,last_status='skipped',last_detail=? WHERE id=?").run(Date.now(), 'Server is in maintenance mode.', id);
        audit(db, workspaceId, 'Automation skipped', `${task.name} · ${server.name} is in maintenance mode.`, 'info', server.id);
        record('skipped','Server is in maintenance mode.');
        return { status: 'skipped', detail: 'Server is in maintenance mode.' };
      }
      runningTasks.add(id);
      try {
        const result = await this.action(workspaceId, task.server_id, task.action, task.action==='broadcast'?renderAnnouncement(task.message,server):task.message, `${actor}: ${task.name}`);
        db.prepare("UPDATE schedules SET last_run=?,last_status='success',last_detail=? WHERE id=?").run(Date.now(), 'Command acknowledged.', id);
        record('success','Command acknowledged.');
        return { status: 'success', detail: 'Command acknowledged.', output: result.output };
      } catch (error) {
        db.prepare("UPDATE schedules SET last_run=?,last_status='failed',last_detail=? WHERE id=?").run(Date.now(), error.message.slice(0, 300), id);
        record('failed',error.message);
        notify(db,workspaceId,'Automation failed',`${task.name} · ${error.message}`,'error','automations',runId);
        throw error;
      } finally { runningTasks.delete(id); }
    },
    async bulkAction(workspaceId, input) {
      const data = bulkSchema.parse(input);
      commandFor(data.action, data.message);
      // Validate the entire selection before executing the first command.
      const selected = data.server_ids.map(id => getServer(workspaceId, id));
      const results = [];
      const run = async server => {
        try { const result = await this.action(workspaceId, server.id, data.action, data.message, 'Bulk action'); return { server_id: server.id, name: server.name, ok: true, detail: result.players ? `${result.players.length} players connected.` : String(result.output).slice(0, 2000) }; }
        catch (error) { return { server_id: server.id, name: server.name, ok: false, detail: error.message }; }
      };
      for (let i = 0; i < selected.length; i += 4) results.push(...await Promise.all(selected.slice(i, i + 4).map(run)));
      return { results };
    },
    async action(workspaceId, serverId, action, message, actor = 'Dashboard') {
      const server = getServer(workspaceId, serverId);
      commandFor(action, message);
      if (busy.has(serverId)) throw Object.assign(new Error('Another command is running on this server. Try again shortly.'), { status: 409 });
      busy.add(serverId);
      try {
        const result = await transport(server, vault, action, message);
        if (result.players) {
          const players = result.players.slice(0, 1000).map(line => String(line).slice(0, 512));
          db.prepare('UPDATE servers SET status=?,players=?,player_list=?,latency=?,last_checked=? WHERE id=?').run('online', players.length, JSON.stringify(players), result.latency, Date.now(), serverId);
        }
        if (action !== 'status') audit(db, workspaceId, ({ save: 'World saved', broadcast: 'Broadcast sent', players: 'Player list requested',kick:'Kick command sent',ban:'Ban command sent',unban:'Unban command sent' })[action] || action, `${server.name} · ${actor}`, 'success', serverId);
        return result;
      } catch (error) {
        if (!error.status) { db.prepare("UPDATE servers SET status='offline',players=0,player_list='[]',latency=NULL,last_checked=? WHERE id=?").run(Date.now(), serverId); error.status = 502; error.message = 'RCON connection failed. Check the address, port, password, and firewall.'; }
        if (action !== 'status') audit(db, workspaceId, 'Command failed', `${server.name} · ${error.message}`, 'error', serverId);
        throw error;
      } finally { busy.delete(serverId); }
    },
    async pollAll(notify = async () => {}) {
      for (const ws of db.prepare('SELECT * FROM workspaces').all()) {
        for (const server of listServers(db, ws.id).slice(0, effectivePlan(ws).servers)) {
          try { await this.action(ws.id, server.id, 'status'); } catch (error) { if (error.status === 409) continue; }
          let updated;try{updated = getServer(ws.id, server.id);}catch{continue;}
          db.prepare('INSERT INTO metrics(server_id,players,online,created_at,latency) VALUES(?,?,?,?,?)').run(server.id, updated.status === 'online' ? updated.players : 0, updated.status === 'online' ? 1 : 0, Date.now(),updated.latency);
          if (server.status !== 'unknown' && server.status !== updated.status) {
            const title = updated.status === 'online' ? 'Server back online' : 'Server went offline';
            audit(db, ws.id, title, server.name, updated.status === 'online' ? 'success' : 'error', server.id);
          }
          await observeHealth(db,ws,updated,notify);
        }
        const cutoff = Date.now() - effectivePlan(ws).historyDays * 86400000;
        db.prepare('DELETE FROM activity WHERE workspace_id=? AND created_at<?').run(ws.id, cutoff);
        db.prepare('DELETE FROM metrics WHERE server_id IN (SELECT id FROM servers WHERE workspace_id=?) AND created_at<?').run(ws.id, cutoff);
        db.prepare('DELETE FROM notifications WHERE workspace_id=? AND created_at<?').run(ws.id,cutoff);
        db.prepare('DELETE FROM schedule_runs WHERE workspace_id=? AND finished_at<?').run(ws.id,cutoff);
        db.prepare('DELETE FROM incidents WHERE workspace_id=? AND resolved_at IS NOT NULL AND resolved_at<?').run(ws.id,cutoff);
      }
    },
    async runDueSchedules() {
      for (const ws of db.prepare('SELECT * FROM workspaces').all()) {
        const schedules = db.prepare('SELECT * FROM schedules WHERE workspace_id=? ORDER BY rowid').all(ws.id).slice(0, effectivePlan(ws).schedules);
        for (const task of schedules.filter(s => s.enabled && s.next_run <= Date.now())) {
          // Claim before execution. Restarted processes never repeat a claimed task.
          const result = db.prepare('UPDATE schedules SET next_run=? WHERE id=? AND next_run=?').run(Date.now() + task.interval_minutes * 60000, task.id, task.next_run);
          if (!result.changes) continue;
          try { await this.runSchedule(ws.id, task.id, 'Automation'); } catch { /* failures are recorded; no unsafe automatic retries */ }
        }
      }
    }
  };
}
