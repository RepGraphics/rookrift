import {onlineRecipient} from '../shared/online-recipient.js';
import {assertGameAction} from '../shared/games.js';
import {assertHostingCapability} from '../shared/hosting-providers.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertCapacity, assertServerEntitled, effectivePlan } from './plans.js';
import { audit, listServers, publicServer } from './db.js';
import { runRcon } from './games.js';
import { commandFor } from './games.js';
import { maintenanceState, renderAnnouncement, observeHealth, notify } from './operations-state.js';
import { observePlayers } from './player-profiles.js';
import {interruptPlayerSessions,prunePlayerActivity} from './player-activity.js';
import { nextRun,validTimeZone } from '../shared/scheduling.js';
import { assertWorkflowIdle } from './workflows.js';
import {createMetadataDiscovery} from './server-metadata.js';
import {cleanServerMetadata} from './server-query.js';
const serverFields = z.object({
  name: z.string().trim().min(2).max(60),
  game: z.enum(['asa', 'ase','minecraft','dayz']),
  map: z.string().trim().max(60),
  host: z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.:-]+$/, 'Enter a hostname or IP address without a URL or port.'),
  port: z.coerce.number().int().min(1).max(65535),
  password: z.string().min(1).max(200),
  max_players: z.coerce.number().int().min(1).max(1000).nullable(),
  query_port:z.preprocess(value=>value===''||value===null?null:value,z.coerce.number().int().min(1).max(65535).nullable()),
  metadata_auto:z.boolean(),
  cluster: z.string().trim().max(40),
  notes: z.string().trim().max(2000)
});
export const serverSchema = serverFields.extend({
  map:serverFields.shape.map.default(''),
  metadata_auto:serverFields.shape.metadata_auto.default(false),
  query_port:serverFields.shape.query_port.default(null),
  max_players: serverFields.shape.max_players.default(70),
  cluster: serverFields.shape.cluster.default(''),
  notes: serverFields.shape.notes.default('')
}).strict();
export const serverUpdateSchema = serverFields.partial().extend({
  password: z.string().max(200).optional(),
  maintenance: z.boolean().optional()
}).strict();
export const scheduleSchema = z.object({
  server_id: z.string().uuid(),
  name: z.string().trim().min(2).max(60),
  action: z.enum(['save', 'broadcast', 'backup']),
  message: z.string().trim().max(300).default(''),
  interval_minutes: z.coerce.number().int().min(15).max(10080).default(60),
  schedule_type:z.enum(['interval','weekly']).default('interval'),
  days:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days=>new Set(days).size===days.length).default([0,1,2,3,4,5,6]),
  start_time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default('04:00'),
  time_zone:z.string().max(80).refine(validTimeZone,'Choose a valid IANA timezone.').default('UTC')
}).strict().refine(data => data.action !== 'broadcast' || data.message.length > 0, {
  message: 'Broadcast message is required.'
});
export const bulkSchema = z.object({
  server_ids: z.array(z.string().uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length, 'Choose each server once.'),
  action: z.enum(['status', 'save', 'broadcast']),
  message: z.string().trim().max(300).optional()
}).strict();
export function createService(db, vault, transport = runRcon,{metadata=createMetadataDiscovery(db,vault)}={}) {
  let requestBackup;
  const busy = new Set(),
    runningTasks = new Set(),metadataBusy=new Set();
  const workspace = async id => await db.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
  async function getServer(workspaceId, serverId, enforce = true) {
    const state=await db.prepare('SELECT w.closed_at,u.deleting_at FROM workspaces w JOIN users u ON u.id=w.owner_id WHERE w.id=?').get(workspaceId);if(!state||state.closed_at||state.deleting_at)throw Object.assign(new Error('This workspace is closing or closed.'),{status:409});
    const servers = await listServers(db, workspaceId),
      server = servers.find(s => s.id === serverId);
    if (!server) throw Object.assign(new Error('Server not found.'), {
      status: 404
    });
    if (enforce) assertServerEntitled(await workspace(workspaceId), servers, serverId);
    return server;
  }
  async function getSchedule(workspaceId, id, enforce = true) {
    const schedules = await db.prepare('SELECT * FROM schedules WHERE workspace_id=? ORDER BY sort_order').all(workspaceId);
    const index = schedules.findIndex(task => task.id === id);
    if (index < 0) throw Object.assign(new Error('Automation not found.'), {
      status: 404
    });
    if (enforce) {
      if (index >= effectivePlan(await workspace(workspaceId)).schedules) throw Object.assign(new Error('This automation is paused by your current plan.'), {
        status: 403
      });
      await getServer(workspaceId, schedules[index].server_id);
    }
    return schedules[index];
  }
  return {
    async refreshMetadata(workspaceId,id,{force=false}={}){
      const server=await getServer(workspaceId,id),previous=server.detected_metadata||{},now=Date.now();
      if((!force&&!server.metadata_auto)||metadataBusy.has(id)||now-(previous.checked_at||0)<(force?15000:300000))return publicServer(server);
      metadataBusy.add(id);
      try{
        let result;try{result=await metadata(server);}catch{result={warning:'Metadata discovery is unavailable. Check query settings and hosting read permissions.'};}
        const values=cleanServerMetadata(result||{});
        return await db.withWorkspaceLock(workspaceId,async()=>{
          const current=await getServer(workspaceId,id);if(current.metadata_revision!==server.metadata_revision)return publicServer(current);
          const detected={...current.detected_metadata,checked_at:now,warning:String(result?.warning||'').slice(0,250),status:values.map&&values.max_players?'ready':values.map||values.max_players?'partial':'unavailable'};
          for(const field of ['map','max_players'])if(values[field]!==undefined){detected[field]=values[field];detected[field+'_source']=result.sources?.[field]||'server-query';detected[field+'_checked_at']=now;detected.last_success_at=now;}
          if(values.query_port)detected.query_port=values.query_port;
          await db.prepare('UPDATE servers SET detected_metadata=?,map=?,max_players=? WHERE id=? AND workspace_id=? AND metadata_revision=?').run(JSON.stringify(detected),current.metadata_auto&&values.map!==undefined?values.map:current.map,current.metadata_auto&&values.max_players!==undefined?values.max_players:current.max_players,id,workspaceId,server.metadata_revision);
          return publicServer(await getServer(workspaceId,id));
        });
      }finally{metadataBusy.delete(id);}
    },
    async pollMetadata(){
      for(const ws of await db.prepare('SELECT * FROM workspaces WHERE closed_at IS NULL').all()){
        const servers=(await listServers(db,ws.id)).slice(0,effectivePlan(ws).servers).filter(server=>server.metadata_auto);
        for(let index=0;index<servers.length;index+=4)await Promise.all(servers.slice(index,index+4).map(server=>this.refreshMetadata(ws.id,server.id).catch(()=>{})));
      }
    },
    setBackupHandler(handler){requestBackup=handler;},
    getServer,
    isBusy:id=>busy.has(id),
    getSchedule,
    async addServer(workspaceId, input) {
      return await db.withWorkspaceLock(workspaceId, async () => {
        const data = serverSchema.parse(input);if(data.metadata_auto&&!Object.hasOwn(input,'max_players'))data.max_players=null;
        if(!data.metadata_auto&&(!data.map||!data.max_players))throw Object.assign(new Error('Enter a map/world and player capacity, or enable automatic server details.'),{status:400});
        const focus=(await workspace(workspaceId)).game_focus;if(focus&&focus!=='mixed'&&focus!==data.game)throw Object.assign(new Error('Choose a server matching this workspace game focus.'),{status:400});
        // Serialize quota checks and inserts against this workspace's PostgreSQL row.
        assertCapacity(await workspace(workspaceId), (await listServers(db, workspaceId)).length);
        const id = randomUUID();
        await db.prepare('INSERT INTO servers(id,workspace_id,name,game,map,host,port,password,max_players,created_at,cluster,notes,metadata_auto,query_port) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, workspaceId, data.name, data.game, data.map, data.host, data.port, vault.encrypt(data.password), data.max_players, Date.now(), data.cluster, data.notes,Number(data.metadata_auto),data.query_port);
        await audit(db, workspaceId, 'Server connected', `${data.name} added. Awaiting first RCON check.`, 'info', id);
        return publicServer(await getServer(workspaceId, id));
      });
    },
    async updateServer(workspaceId, id, input) {
      const data = serverUpdateSchema.parse(input);
      const focus=(await workspace(workspaceId)).game_focus;if(data.game&&(focus&&focus!=='mixed'&&data.game!==focus))throw Object.assign(new Error('Choose a game matching this workspace focus.'),{status:400});
      await getServer(workspaceId, id, false);
      if (busy.has(id)) throw Object.assign(new Error('Wait for the current server command to finish before editing its connection.'), {
        status: 409
      });
      busy.add(id);
      try {
        return await db.withWorkspaceLock(workspaceId, async () => {
          const original = await getServer(workspaceId, id, false);
          await assertWorkflowIdle(db,id);
          if (data.game && data.game !== original.game && ((await db.prepare('SELECT 1 FROM player_observations WHERE server_id=? LIMIT 1').get(id)) || (await db.prepare('SELECT 1 FROM moderation WHERE server_id=? LIMIT 1').get(id)))) throw Object.assign(new Error('Add a new connection to change games after player or moderation history exists.'), {
            status: 409
          });
          const changed = ['host', 'port', 'game'].some(key => data[key] !== undefined && data[key] !== original[key]) || Boolean(data.password),
            updated = {
              ...original,
              ...data,
              password: data.password ? vault.encrypt(data.password) : original.password,
              metadata_auto:data.metadata_auto===undefined?original.metadata_auto:Number(data.metadata_auto),
              maintenance: data.maintenance === undefined ? original.maintenance : Number(data.maintenance)
            };
          if(!updated.metadata_auto&&(!updated.map||!updated.max_players))throw Object.assign(new Error('Enter a map/world and player capacity before disabling automatic details.'),{status:400});
          const metadataChanged=changed||data.query_port!==undefined&&data.query_port!==original.query_port;
          let detected=metadataChanged?{}:original.detected_metadata||{};
          if(updated.metadata_auto){if(metadataChanged){updated.map='';updated.max_players=null;}else{if(detected.map)updated.map=detected.map;if(detected.max_players)updated.max_players=detected.max_players;}}
          await db.prepare('UPDATE servers SET name=?,game=?,map=?,host=?,port=?,password=?,max_players=?,cluster=?,maintenance=?,notes=?,metadata_auto=?,query_port=?,detected_metadata=?,metadata_revision=metadata_revision+1 WHERE id=? AND workspace_id=?').run(updated.name, updated.game, updated.map, updated.host, updated.port, updated.password, updated.max_players, updated.cluster, updated.maintenance, updated.notes,updated.metadata_auto,updated.query_port,JSON.stringify(detected), id, workspaceId);
          if(changed)await interruptPlayerSessions(db,original,'connection_changed');
          if (changed) await db.prepare("UPDATE servers SET status='unknown',players=0,latency=NULL,last_checked=NULL,player_list='[]',failed_checks=0,failed_since=NULL WHERE id=?").run(id);
          await audit(db, workspaceId, original.maintenance !== updated.maintenance ? updated.maintenance ? 'Maintenance enabled' : 'Maintenance ended' : 'Server settings updated', updated.name, 'info', id);
          return publicServer(await getServer(workspaceId, id, false));
        });
      } finally {
        busy.delete(id);
      }
    },
    async addSchedule(workspaceId, input) {
      return await db.withWorkspaceLock(workspaceId, async () => {
        const data = scheduleSchema.parse(input),
          ws = await workspace(workspaceId);
        const targetServer=await getServer(workspaceId,data.server_id);if(data.action!=='backup')assertGameAction(targetServer.game,data.action);
        assertCapacity(ws, (await db.prepare('SELECT count(*) AS n FROM schedules WHERE workspace_id=?').get(workspaceId)).n, 'schedules');
        const id = randomUUID();
        if(data.action==='backup'){const connection=await db.prepare('SELECT provider FROM hosting_connections WHERE server_id=? AND workspace_id=?').get(data.server_id,workspaceId);if(!connection)throw Object.assign(new Error('Connect a hosting provider before scheduling backups.'),{status:400});assertHostingCapability(connection.provider,'backups');}
        await db.prepare('INSERT INTO schedules(id,workspace_id,server_id,name,action,message,interval_minutes,next_run,enabled,schedule_type,days,start_time,time_zone) VALUES(?,?,?,?,?,?,?,?,1,?,?,?,?)').run(id, workspaceId, data.server_id, data.name, data.action, data.message, data.interval_minutes, nextRun(data),data.schedule_type,JSON.stringify(data.days),data.start_time,data.time_zone);
        await audit(db, workspaceId, 'Automation created', data.name);
        return await db.prepare('SELECT * FROM schedules WHERE id=?').get(id);
      });
    },
    async updateSchedule(workspaceId, id, input) {
      await getSchedule(workspaceId, id, false);
      if (runningTasks.has(id)) throw Object.assign(new Error('Wait for this automation to finish before editing it.'), {
        status: 409
      });
      runningTasks.add(id);
      try {
        return await db.withWorkspaceLock(workspaceId, async () => {
          const original = await getSchedule(workspaceId, id, false);
          if (input && Object.keys(input).length === 1 && typeof input.enabled === 'boolean') {
            if (input.enabled) await getSchedule(workspaceId, id);
            await db.prepare('UPDATE schedules SET enabled=?,next_run=? WHERE id=?').run(Number(input.enabled), input.enabled ? nextRun(original) : original.next_run, id);
          } else {
            await getSchedule(workspaceId, id);
            const data = scheduleSchema.parse(input);
            const targetServer=await getServer(workspaceId,data.server_id);if(data.action!=='backup')assertGameAction(targetServer.game,data.action);
            if(data.action==='backup'){const connection=await db.prepare('SELECT provider FROM hosting_connections WHERE server_id=? AND workspace_id=?').get(data.server_id,workspaceId);if(!connection)throw Object.assign(new Error('Connect a hosting provider before scheduling backups.'),{status:400});assertHostingCapability(connection.provider,'backups');}
            await db.prepare('UPDATE schedules SET server_id=?,name=?,action=?,message=?,interval_minutes=?,next_run=?,schedule_type=?,days=?,start_time=?,time_zone=? WHERE id=?').run(data.server_id, data.name, data.action, data.message, data.interval_minutes, nextRun(data),data.schedule_type,JSON.stringify(data.days),data.start_time,data.time_zone,id);
          }
          await audit(db, workspaceId, 'Automation updated', original.name);
          return getSchedule(workspaceId, id, false);
        });
      } finally {
        runningTasks.delete(id);
      }
    },
    async deleteSchedule(workspaceId, id) {
      await getSchedule(workspaceId, id, false);
      if (runningTasks.has(id)) throw Object.assign(new Error('Wait for this automation to finish before deleting it.'), {
        status: 409
      });
      runningTasks.add(id);
      try {
        await db.withWorkspaceLock(workspaceId, async () => {
          const task = await getSchedule(workspaceId, id, false);
          await db.prepare('DELETE FROM schedules WHERE id=? AND workspace_id=?').run(id, workspaceId);
          await audit(db, workspaceId, 'Automation removed', task.name);
        });
      } finally {
        runningTasks.delete(id);
      }
    },
    async runSchedule(workspaceId, id, actor = 'Run now') {
      const task = await getSchedule(workspaceId, id);
      const runId = randomUUID(),
        started = Date.now();
      const record = async (status, detail) => await db.prepare('INSERT INTO schedule_runs VALUES(?,?,?,?,?,?,?,?)').run(runId, workspaceId, id, task.server_id, started, Date.now(), status, String(detail).slice(0, 1000));
      if (runningTasks.has(id)) throw Object.assign(new Error('This automation is already running.'), {
        status: 409
      });
      runningTasks.add(id);
      try {
        const server = await getServer(workspaceId, task.server_id);
        let reservation='';try{await assertWorkflowIdle(db,server.id);}catch(error){if(error.status!==409)throw error;reservation=error.message;}
        if (reservation||(await maintenanceState(db, server)).in_maintenance) {
          const detail=reservation||'Server is in maintenance mode.';
          await db.prepare("UPDATE schedules SET last_run=?,last_status='skipped',last_detail=? WHERE id=?").run(Date.now(), detail, id);
          await audit(db, workspaceId, 'Automation skipped', `${task.name} · ${server.name} · ${detail}`, 'info', server.id);
          await record('skipped', detail);
          return {
            status: 'skipped',
            detail
          };
        }
        if(task.action==='backup'&&!requestBackup)throw Object.assign(new Error('Hosting backup execution is unavailable.'),{status:503});
        const result = task.action==='backup'?await requestBackup(workspaceId,server):await this.action(workspaceId, task.server_id, task.action, task.action === 'broadcast' ? renderAnnouncement(task.message, server) : task.message, `${actor}: ${task.name}`);
        const detail=task.action==='backup'?'Backup request accepted by provider. Check Hosting & backups for completion.':'Command acknowledged.';
        await db.prepare("UPDATE schedules SET last_run=?,last_status='success',last_detail=? WHERE id=?").run(Date.now(), detail, id);
        await record('success', detail);
        return {
          status: 'success',
          detail,
          output: result.output
        };
      } catch (error) {
        await db.prepare("UPDATE schedules SET last_run=?,last_status='failed',last_detail=? WHERE id=?").run(Date.now(), error.message.slice(0, 300), id);
        await record('failed', error.message);
        await notify(db, workspaceId, 'Automation failed', `${task.name} · ${error.message}`, 'error', 'automations', runId);
        throw error;
      } finally {
        runningTasks.delete(id);
      }
    },
    async bulkAction(workspaceId, input) {
      const data = bulkSchema.parse(input);
      commandFor(data.action, data.message);
      // Validate the entire selection before executing the first command.
      const selected = await Promise.all(data.server_ids.map(async id => await getServer(workspaceId, id)));
      for(const server of selected)commandFor(data.action,data.message,server.game);
      const results = [];
      const run = async server => {
        try {
          const result = await this.action(workspaceId, server.id, data.action, data.message, 'Bulk action');
          return {
            server_id: server.id,
            name: server.name,
            ok: true,
            detail: result.players ? `${result.players.length} players connected.` : String(result.output).slice(0, 2000)
          };
        } catch (error) {
          return {
            server_id: server.id,
            name: server.name,
            ok: false,
            detail: error.message
          };
        }
      };
      for (let i = 0; i < selected.length; i += 4) results.push(...(await Promise.all(selected.slice(i, i + 4).map(run))));
      return {
        results
      };
    },
    async purchaseCommand(workspaceId,serverId,command,beforeSend,delivery={}){
      commandFor('purchase',command);if(busy.has(serverId))throw Object.assign(new Error('Another server command is running.'),{status:409,code:'SERVER_BUSY'});busy.add(serverId);
      try{const server=await getServer(workspaceId,serverId);commandFor('purchase',command,server.game);await assertWorkflowIdle(db,serverId);if((await maintenanceState(db,server)).in_maintenance||server.status!=='online'||!server.last_checked||Date.now()-server.last_checked>180000)throw Object.assign(new Error('Waiting for the server to be online and outside maintenance.'),{status:409,code:'TARGET_NOT_READY'});if(delivery.requireOnline){let live;try{live=await transport(server,vault,'players','');}catch(error){if(error.code==='PLAYER_LIST_FORMAT')throw error;throw Object.assign(new Error('Waiting for a successful recipient presence check.'),{status:409,code:'TARGET_NOT_READY'});}if(!onlineRecipient(server.game,delivery.identityKind,delivery.identifier,live.players))throw Object.assign(new Error('Waiting for the recipient to be online.'),{status:409,code:'TARGET_NOT_READY'});}await beforeSend(server);return await transport(server,vault,'purchase',command);}finally{busy.delete(serverId);}
    },
    async action(workspaceId, serverId, action, message, actor = 'Dashboard') {
      const server = await getServer(workspaceId, serverId);
      commandFor(action, message,server.game);
      if (busy.has(serverId)) throw Object.assign(new Error('Another command is running on this server. Try again shortly.'), {
        status: 409,code:'SERVER_BUSY'
      });
      busy.add(serverId);
      try {
        const result = await transport(server, vault, action, message);
        if (result.players) {
          const players = result.players.slice(0, 1000).map(line => String(line).slice(0, 512));
          const checkedAt = Date.now();
          await db.prepare('UPDATE servers SET status=?,players=?,player_list=?,latency=?,last_checked=? WHERE id=?').run('online', players.length, JSON.stringify(players), result.latency, checkedAt, serverId);
          await observePlayers(db, server, players, checkedAt);
          const metadata=cleanServerMetadata(result.metadata||{});
          if(server.metadata_auto&&server.game==='minecraft'&&metadata.max_players)await db.withWorkspaceLock(workspaceId,async()=>{const current=await getServer(workspaceId,serverId);if(current.metadata_revision!==server.metadata_revision||!current.metadata_auto)return;const detected={...current.detected_metadata,max_players:metadata.max_players,max_players_source:'minecraft-rcon',max_players_checked_at:checkedAt,last_success_at:checkedAt};await db.prepare('UPDATE servers SET max_players=?,detected_metadata=? WHERE id=?').run(metadata.max_players,JSON.stringify(detected),serverId);});
        }
        if (action !== 'status' && action !== 'chat') await audit(db, workspaceId, {
          save: 'World saved',
          broadcast: 'Broadcast sent',
          players: 'Player list requested',
          kick: 'Kick command sent',
          ban: 'Ban command sent',
          unban: 'Unban command sent'
        }[action] || action, `${server.name} · ${actor}`, 'success', serverId);
        return result;
      } catch (error) {
        if(!error.status||error.code==='PLAYER_LIST_FORMAT')await interruptPlayerSessions(db,server,error.code==='PLAYER_LIST_FORMAT'?'unreliable_snapshot':'connection_lost');
        if (!error.status) {
          await db.prepare("UPDATE servers SET status='offline',players=0,player_list='[]',latency=NULL,last_checked=? WHERE id=?").run(Date.now(), serverId);
          await db.prepare('UPDATE player_observations SET online=0 WHERE server_id=?').run(serverId);
          error.status = 502;
          error.message = 'RCON connection failed. Check the address, port, password, and firewall.';
        }
        if (action !== 'status') await audit(db, workspaceId, 'Command failed', `${server.name} · ${error.message}`, 'error', serverId);
        throw error;
      } finally {
        busy.delete(serverId);
      }
    },
    async directMessage(workspaceId, serverId, player, message) {
      const server = await getServer(workspaceId, serverId);
      const payload = `${player}|${message}`;
      commandFor('direct', payload, server.game);
      if (busy.has(serverId)) throw Object.assign(new Error('Another command is running on this server. Try again shortly.'), { status: 409, code: 'SERVER_BUSY' });
      busy.add(serverId);
      try {
        return await transport(server, vault, 'direct', payload);
      } finally {
        busy.delete(serverId);
      }
    },
    async chat(workspaceId, serverId) {
      const server = await getServer(workspaceId, serverId);
      commandFor('chat', '', server.game);
      if (busy.has(serverId)) throw Object.assign(new Error('Another command is running on this server. Try again shortly.'), { status: 409, code: 'SERVER_BUSY' });
      busy.add(serverId);
      try {
        return await transport(server, vault, 'chat', '');
      } finally {
        busy.delete(serverId);
      }
    },
    async pollAll(notify = async () => {}) {
      for (const ws of await db.prepare('SELECT * FROM workspaces WHERE closed_at IS NULL').all()) {
        for (const server of (await listServers(db, ws.id)).slice(0, effectivePlan(ws).servers)) {
          try {
            await this.action(ws.id, server.id, 'status');
          } catch (error) {
            if (error.status === 409) continue;
          }
          let updated;
          try {
            updated = await getServer(ws.id, server.id);
          } catch {
            continue;
          }
          await db.prepare('INSERT INTO metrics(server_id,players,online,created_at,latency) VALUES(?,?,?,?,?)').run(server.id, updated.status === 'online' ? updated.players : 0, updated.status === 'online' ? 1 : 0, Date.now(), updated.latency);
          if (server.status !== 'unknown' && server.status !== updated.status) {
            const title = updated.status === 'online' ? 'Server back online' : 'Server went offline';
            await audit(db, ws.id, title, server.name, updated.status === 'online' ? 'success' : 'error', server.id);
          }
          await observeHealth(db, ws, updated, notify);
        }
        await prunePlayerActivity(db,ws);
        const cutoff = Date.now() - effectivePlan(ws).historyDays * 86400000;
        await db.prepare('DELETE FROM activity WHERE workspace_id=? AND created_at<?').run(ws.id, cutoff);
        await db.prepare('DELETE FROM metrics WHERE server_id IN (SELECT id FROM servers WHERE workspace_id=?) AND created_at<?').run(ws.id, cutoff);
        await db.prepare('DELETE FROM notifications WHERE workspace_id=? AND created_at<?').run(ws.id, cutoff);
        await db.prepare('DELETE FROM schedule_runs WHERE workspace_id=? AND finished_at<?').run(ws.id, cutoff);
        await db.prepare('DELETE FROM incidents WHERE workspace_id=? AND resolved_at IS NOT NULL AND resolved_at<?').run(ws.id, cutoff);
      }
    },
    async runDueSchedules() {
      for (const ws of await db.prepare('SELECT * FROM workspaces').all()) {
        const schedules = (await db.prepare('SELECT * FROM schedules WHERE workspace_id=? ORDER BY sort_order').all(ws.id)).slice(0, effectivePlan(ws).schedules);
        for (const task of schedules.filter(s => s.enabled && s.next_run <= Date.now())) {
          // Claim before execution. Restarted processes never repeat a claimed task.
          const result = await db.prepare('UPDATE schedules SET next_run=? WHERE id=? AND next_run=?').run(nextRun(task), task.id, task.next_run);
          if (!result.changes) continue;
          try {
            await this.runSchedule(ws.id, task.id, 'Automation');
          } catch {/* failures are recorded; no unsafe automatic retries */}
        }
      }
    },
    async removeServer(workspaceId, id) {
      await getServer(workspaceId, id, false);
      if (busy.has(id)) throw Object.assign(new Error('Wait for the current server command to finish before removing its connection.'), {
        status: 409
      });
      busy.add(id);
      try {
        return await db.withWorkspaceLock(workspaceId, async () => {
          const server = await getServer(workspaceId, id, false);
          await assertWorkflowIdle(db,id);
          await db.prepare('DELETE FROM servers WHERE id=? AND workspace_id=?').run(id, workspaceId);
          const site=await db.prepare('SELECT server_ids FROM community_sites WHERE workspace_id=?').get(workspaceId);
          if(site)await db.prepare('UPDATE community_sites SET server_ids=?,updated_at=? WHERE workspace_id=?').run(JSON.stringify(JSON.parse(site.server_ids).filter(server=>server!==id)),Date.now(),workspaceId);
          for (const window of await db.prepare('SELECT id,server_ids FROM maintenance_windows WHERE workspace_id=?').all(workspaceId)) {
            const current = JSON.parse(window.server_ids);
            if (!current.includes(id)) continue;
            const remaining = current.filter(value => value !== id);
            if (remaining.length) await db.prepare('UPDATE maintenance_windows SET server_ids=? WHERE id=?').run(JSON.stringify(remaining), window.id);else await db.prepare('DELETE FROM maintenance_windows WHERE id=?').run(window.id);
          }
          await audit(db, workspaceId, 'Server removed', server.name);
          return {
            ok: true
          };
        });
      } finally {
        busy.delete(id);
      }
    }
  };
}
