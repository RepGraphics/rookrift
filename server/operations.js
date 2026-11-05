import {hostingCapabilities,assertHostingCapability} from '../shared/hosting-providers.js';
import { createMetricsCache } from './cache.js';
import {assertWorkflowIdle} from './workflows.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertCapacity, effectivePlan } from './plans.js';
import { audit, listServers, playerSnapshot } from './db.js';
import { commandFor } from './games.js';
import { createHostingAdapter } from './hosting.js';
import { listWindows, maintenanceState, renderAnnouncement, notify } from './operations-state.js';
import { normalizeIdentity, tryIdentity, ID_KINDS } from '../shared/ban-identity.js';
import { syncBanReports } from './ban-directory.js';
export const templateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  body: z.string().trim().min(1).max(300)
}).strict().refine(value => ![...value.body.matchAll(/\{([^{}]+)\}/g)].some(([, key]) => !['server', 'map', 'players', 'cluster'].includes(key)), {
  message: 'Supported placeholders: {server}, {map}, {players}, {cluster}.'
});
export const windowSchema = z.object({
  name: z.string().trim().min(2).max(60),
  server_ids: z.array(z.string().uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  duration_minutes: z.coerce.number().int().min(15).max(1440),
  time_zone: z.string().max(80).refine(value => {
    try {
      new Intl.DateTimeFormat('en', {
        timeZone: value
      });
      return true;
    } catch {
      return false;
    }
  }, 'Enter a valid IANA time zone.'),
  enabled: z.boolean().default(true)
}).strict();
export const hostingSchema = z.object({
  provider: z.enum(['pterodactyl','pelican','nitrado']),
  origin: z.string().url().max(250).refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  }, 'Enter only the HTTPS panel origin.'),
  remote_id: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  api_key: z.string().trim().max(512).regex(/^[\x21-\x7e]*$/).optional()
}).strict().superRefine((v,c)=>{if(v.provider==='nitrado'){if(new URL(v.origin).origin!=='https://api.nitrado.net')c.addIssue({code:'custom',message:'Use https://api.nitrado.net for Nitrado.'});if(!/^[1-9]\d{0,13}$/.test(v.remote_id))c.addIssue({code:'custom',message:'Use a numeric Nitrado service ID.'});}else if(!/^[a-zA-Z0-9-]{8,64}$/.test(v.remote_id))c.addIssue({code:'custom',message:'Use the panel server identifier or UUID.'});});
export function createOperations(db, vault, service, hosting = createHostingAdapter(), cache = createMetricsCache({
  url: null
})) {
  const hostBusy = new Set(),
    moderationBusy = new Set();
  const ws = async id => await db.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
  async function owned(table, workspace, id) {
    const row = await db.prepare(`SELECT * FROM ${table} WHERE id=? AND workspace_id=?`).get(id, workspace);
    if (!row) throw Object.assign(new Error('Record not found.'), {
      status: 404
    });
    return row;
  }
  const hostConnection = async (workspace, id) => {
    await service.getServer(workspace, id);
    const row = await db.prepare('SELECT * FROM hosting_connections WHERE server_id=? AND workspace_id=?').get(id, workspace);
    if (!row) throw Object.assign(new Error('Connect a hosting panel for this server first.'), {
      status: 409
    });
    return {
      ...row,
      key: vault.decrypt(row.api_key)
    };
  };
  return {
    async withConfigHost(workspace,id,callback,exceptConfig=null){
      if(hostBusy.has(id))throw Object.assign(new Error('A hosting request is already running for this server.'),{status:409});hostBusy.add(id);
      try{await assertWorkflowIdle(db,id,null,exceptConfig);const connection=await hostConnection(workspace,id);assertHostingCapability(connection.provider,'files');if(!hosting.readFile||!hosting.writeFile)throw Object.assign(new Error('This hosting adapter does not support configuration files.'),{status:400});return await callback({target:connection.origin+'\0'+connection.remote_id,resources:()=>hosting.resources(connection),read:path=>hosting.readFile(connection,path),write:(path,body)=>hosting.writeFile(connection,path,body)});}finally{hostBusy.delete(id);}
    },
    async listTemplates(workspace) {
      return await db.prepare('SELECT id,name,body,created_at,updated_at FROM announcement_templates WHERE workspace_id=? ORDER BY created_at,id').all(workspace);
    },
    async saveTemplate(workspace, input, id) {
      return await db.withWorkspaceLock(workspace, async () => {
        const value = templateSchema.parse(input);
        if (id) await owned('announcement_templates', workspace, id);else assertCapacity(await ws(workspace), (await this.listTemplates(workspace)).length, 'templates');
        const now = Date.now();
        if (id) await db.prepare('UPDATE announcement_templates SET name=?,body=?,updated_at=? WHERE id=?').run(value.name, value.body, now, id);else {
          id = randomUUID();
          await db.prepare('INSERT INTO announcement_templates VALUES(?,?,?,?,?,?)').run(id, workspace, value.name, value.body, now, now);
        }
        await audit(db, workspace, 'Announcement template saved', value.name);
        return await owned('announcement_templates', workspace, id);
      });
    },
    async deleteTemplate(workspace, id) {
      await owned('announcement_templates', workspace, id);
      await db.prepare('DELETE FROM announcement_templates WHERE id=? AND workspace_id=?').run(id, workspace);
    },
    async sendTemplate(workspace, id, ids) {
      const template = await owned('announcement_templates', workspace, id);
      const parsed = z.array(z.string().uuid()).min(1).max(20).refine(value => new Set(value).size === value.length).parse(ids);
      const targets = await Promise.all(parsed.map(async serverId => {
        const server = await service.getServer(workspace, serverId);
        const message = renderAnnouncement(template.body, server);
        commandFor('broadcast', message);
        return {
          server,
          message
        };
      }));
      const results = [];
      for (let offset = 0; offset < targets.length; offset += 4) results.push(...(await Promise.all(targets.slice(offset, offset + 4).map(async ({
        server,
        message
      }) => {
        try {
          const result = await service.action(workspace, server.id, 'broadcast', message, `Announcement: ${template.name}`);
          return {
            server_id: server.id,
            name: server.name,
            ok: true,
            detail: result.output
          };
        } catch (error) {
          return {
            server_id: server.id,
            name: server.name,
            ok: false,
            detail: error.message
          };
        }
      }))));
      return {
        results
      };
    },
    async windows(workspace) {
      return await listWindows(db, workspace);
    },
    async saveWindow(workspace, input, id) {
      return await db.withWorkspaceLock(workspace, async () => {
        const value = windowSchema.parse(input);
        for (const _item of value.server_ids) {
          await (async server => await service.getServer(workspace, server))(_item);
        }
        if (id) {
          const rows = await listWindows(db, workspace);
          const row = rows.find(window => window.id === id);
          if (!row) throw Object.assign(new Error('Maintenance window not found.'), {
            status: 404
          });
          if (row.paused) throw Object.assign(new Error('This window is paused by your plan.'), {
            status: 403
          });
        } else assertCapacity(await ws(workspace), (await listWindows(db, workspace)).length, 'windows');
        if (id) await db.prepare('UPDATE maintenance_windows SET name=?,server_ids=?,days=?,start_time=?,duration_minutes=?,time_zone=?,enabled=? WHERE id=?').run(value.name, JSON.stringify(value.server_ids), JSON.stringify(value.days), value.start_time, value.duration_minutes, value.time_zone, Number(value.enabled), id);else {
          id = randomUUID();
          await db.prepare('INSERT INTO maintenance_windows VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, workspace, value.name, JSON.stringify(value.server_ids), JSON.stringify(value.days), value.start_time, value.duration_minutes, value.time_zone, Number(value.enabled), Date.now());
        }
        await audit(db, workspace, 'Maintenance window saved', value.name);
        return (await listWindows(db, workspace)).find(window => window.id === id);
      });
    },
    async deleteWindow(workspace, id) {
      await owned('maintenance_windows', workspace, id);
      await db.prepare('DELETE FROM maintenance_windows WHERE id=?').run(id);
      await audit(db, workspace, 'Maintenance window removed', 'Recurring maintenance settings updated.');
    },
    async health(workspace, id, hours = 24) {
      await service.getServer(workspace, id);
      const available = effectivePlan(await ws(workspace)).historyDays * 24;
      if (!Number.isInteger(hours) || hours < 1 || hours > available) throw Object.assign(new Error('Your plan provides up to ' + available + ' hours of history.'), {
        status: 403
      });
      const metrics = await cache.remember(workspace + ':' + id + ':' + hours, 15, async () => {
        const since = Date.now() - hours * 3600000,
          bucket = Math.max(300000, Math.ceil(hours * 3600000 / 96 / 60000) * 60000);
        const [stats, series] = await Promise.all([db.prepare('SELECT COUNT(*) AS samples,AVG(online)*100 AS availability,percentile_disc(0.95) WITHIN GROUP(ORDER BY latency) FILTER(WHERE online=1 AND latency IS NOT NULL) AS p95_latency,COALESCE(MAX(players),0) AS peak_players FROM metrics WHERE server_id=? AND created_at>=?').get(id, since), db.prepare('SELECT (created_at / ?::bigint)*?::bigint AS time,round(AVG(players))::int AS players,AVG(online)*100 AS availability,round(AVG(latency) FILTER(WHERE online=1 AND latency IS NOT NULL))::int AS latency FROM metrics WHERE server_id=? AND created_at>=? GROUP BY time ORDER BY time').all(bucket, bucket, id, since)]);
        return {
          hours,
          ...stats,
          series
        };
      });
      const incidents = await db.prepare('SELECT * FROM incidents WHERE server_id=? AND opened_at>=? ORDER BY opened_at').all(id, Date.now() - hours * 3600000);
      return {
        ...metrics,
        incidents
      };
    },
    async incidents(workspace) {
      return await db.prepare('SELECT i.*,s.name AS server_name FROM incidents i JOIN servers s ON s.id=i.server_id WHERE i.workspace_id=? ORDER BY (i.resolved_at IS NULL) DESC,i.opened_at DESC LIMIT 100').all(workspace);
    },
    async updateIncident(workspace, id, input) {
      const row = await owned('incidents', workspace, id);
      const value = z.object({
        acknowledged: z.boolean().optional(),
        notes: z.string().trim().max(2000).optional()
      }).strict().parse(input);
      await db.prepare('UPDATE incidents SET acknowledged_at=?,notes=? WHERE id=?').run(value.acknowledged === undefined ? row.acknowledged_at : value.acknowledged ? Date.now() : null, value.notes ?? row.notes, id);
      await audit(db, workspace, 'Incident updated', 'Acknowledgement or internal note updated.', 'info', row.server_id);
      return await owned('incidents', workspace, id);
    },
    async notifications(workspace) {
      return {
        items: await db.prepare('SELECT * FROM notifications WHERE workspace_id=? ORDER BY (read_at IS NULL) DESC,created_at DESC LIMIT 50').all(workspace),
        unread: (await db.prepare('SELECT count(*) AS n FROM notifications WHERE workspace_id=? AND read_at IS NULL').get(workspace)).n
      };
    },
    async readNotification(workspace, id) {
      if (id === 'all') await db.prepare('UPDATE notifications SET read_at=? WHERE workspace_id=? AND read_at IS NULL').run(Date.now(), workspace);else {
        await owned('notifications', workspace, id);
        await db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND workspace_id=?').run(Date.now(), id, workspace);
      }
    },
    async runs(workspace, id) {
      await service.getSchedule(workspace, id, false);
      return await db.prepare('SELECT * FROM schedule_runs WHERE workspace_id=? AND schedule_id=? AND finished_at>=? ORDER BY finished_at DESC LIMIT 50').all(workspace, id, Date.now() - effectivePlan(await ws(workspace)).historyDays * 86400000);
    },
    async moderation(workspace) {
      return await db.prepare('SELECT m.*,s.name AS server_name FROM moderation m JOIN servers s ON s.id=m.server_id WHERE m.workspace_id=? ORDER BY m.active DESC,m.created_at DESC LIMIT 200').all(workspace);
    },
    async moderate(workspace, input, actor) {
      const value = z.object({
        server_id: z.string().uuid(),
        identifier: z.string().regex(/^[A-Za-z0-9_-]{3,128}$/),
        identity_kind: z.enum(ID_KINDS).default('auto'),
        action: z.enum(['kick', 'ban', 'unban']),
        reason: z.string().trim().min(3).max(300)
      }).strict().parse(input);
      const identity = normalizeIdentity(value.identifier, value.identity_kind);
      const key = `${value.server_id}:${identity.key}`;
      if (moderationBusy.has(key)) throw Object.assign(new Error('A moderation command is already running for this player.'), {
        status: 409
      });
      moderationBusy.add(key);
      try {
        const server = await service.getServer(workspace, value.server_id);
        const active = await db.prepare("SELECT * FROM moderation WHERE server_id=? AND identity_key=? AND action='ban' AND active=1").get(server.id, identity.key);
        if (value.action === 'ban' && active) throw Object.assign(new Error('A tracked ban already exists for this identifier.'), {
          status: 409
        });
        if (value.action === 'unban' && !active) throw Object.assign(new Error('No tracked ban exists for this player.'), {
          status: 404
        });
        const player = playerSnapshot([server]).find(player => tryIdentity(player.identifier, identity.kind)?.key === identity.key);
        if (value.action !== 'unban' && !player) throw Object.assign(new Error('Refresh the player list and select a currently reported player.'), {
          status: 409
        });
        const target = value.action === 'unban' ? active.identifier : player.identifier;
        const result = await service.action(workspace, server.id, value.action, target, actor);
        if (/(unknown command|unrecognized command|invalid.*id|not found)/i.test(result.output)) throw Object.assign(new Error('The game rejected the moderation command. Check the reported identifier and provider support.'), {
          status: 422
        });
        const id = randomUUID();
        await db.withWorkspaceLock(workspace, async () => {
          if (value.action === 'unban') await db.prepare('UPDATE moderation SET active=0 WHERE server_id=? AND identity_key=? AND active=1').run(server.id, identity.key);
          await db.prepare('INSERT INTO moderation(id,workspace_id,server_id,identifier,player_name,action,reason,actor,active,created_at,identity_kind,identity_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, workspace, server.id, target, player?.name || active?.player_name || target, value.action, value.reason, String(actor).slice(0, 100), value.action === 'ban' ? 1 : 0, Date.now(), identity.kind, identity.key);
          if (value.action !== 'kick') await syncBanReports(db, workspace);
        });
        return {
          id,
          detail: 'Moderation command acknowledged. Refresh the player snapshot to verify the game state.',
          output: String(result.output).slice(0, 1000)
        };
      } finally {
        moderationBusy.delete(key);
      }
    },
    async hostingLinks(workspace) {
      return (await db.prepare('SELECT server_id,provider,origin,remote_id,verified_at FROM hosting_connections WHERE workspace_id=?').all(workspace)).map(row=>({...row,capabilities:hostingCapabilities(row.provider)}));
    },
    async connectHosting(workspace, id, input) {
      await service.getServer(workspace, id);
      const parsed=hostingSchema.parse(input),value={...parsed,origin:new URL(parsed.origin).origin};
      const previous = await db.prepare('SELECT * FROM hosting_connections WHERE server_id=? AND workspace_id=?').get(id, workspace);
      if (!value.api_key && (!previous || previous.provider!==value.provider || new URL(previous.origin).origin !== new URL(value.origin).origin)) throw Object.assign(new Error('Enter an API key when connecting a new panel origin.'), {
        status: 400
      });
      const key = value.api_key || vault.decrypt(previous.api_key);
      await hosting.resources({
        ...value,
        key
      });
      await db.withWorkspaceLock(workspace,async()=>{await service.getServer(workspace,id);await assertWorkflowIdle(db,id);
      await db.prepare('INSERT INTO hosting_connections VALUES(?,?,?,?,?,?,?) ON CONFLICT(server_id) DO UPDATE SET provider=excluded.provider,origin=excluded.origin,remote_id=excluded.remote_id,api_key=excluded.api_key,verified_at=excluded.verified_at').run(id, workspace, value.provider, new URL(value.origin).origin, value.remote_id, vault.encrypt(key), Date.now());
      await audit(db, workspace, 'Hosting panel connected', hostingCapabilities(value.provider).name+' connection verified.', 'success', id);});
      return (await this.hostingLinks(workspace)).find(link => link.server_id === id);
    },
    async disconnectHosting(workspace, id) {
      await service.getServer(workspace, id, false);
      await db.withWorkspaceLock(workspace,async()=>{await assertWorkflowIdle(db,id);await db.prepare('DELETE FROM hosting_connections WHERE server_id=? AND workspace_id=?').run(id, workspace);});
    },
    async hostingStatus(workspace, id) {
      const connection = await hostConnection(workspace, id);
      const [resources, backups] = await Promise.all([hosting.resources(connection), hostingCapabilities(connection.provider).backups?hosting.backups(connection):[]]);
      return {
        connected: true,
        provider: connection.provider,
        capabilities:hostingCapabilities(connection.provider),
        resources,
        backups
      };
    },
    async hostingResources(workspace,id){return hosting.resources(await hostConnection(workspace,id));},
    async hostingBackupStatus(workspace,id,backupId){const connection=await hostConnection(workspace,id);assertHostingCapability(connection.provider,'backups');return hosting.backup?hosting.backup(connection,backupId):(await hosting.backups(connection)).find(item=>item.id===backupId)||{status:'unknown'};},
    async hostingAction(workspace, id, input,internal={}) {
      const server = await service.getServer(workspace, id);
      const value = z.object({
        action: z.enum(['start', 'stop', 'restart', 'backup']),
        confirmation: z.string().max(60)
      }).strict().parse(input);
      await assertWorkflowIdle(db,id,internal.workflowRun||null,null,value.action==='stop');
      if (value.confirmation !== server.name) throw Object.assign(new Error('Type the exact game server name to confirm this hosting action.'), {
        status: 400
      });
      if (hostBusy.has(id)) throw Object.assign(new Error('Another hosting request is running for this server.'), {
        status: 409,code:'SERVER_BUSY'
      });
      hostBusy.add(id);
      try {
        const connection = await hostConnection(workspace, id);
        assertHostingCapability(connection.provider,value.action==='backup'?'backups':value.action);
        const result = await hosting.action(connection, value.action, `Rookrift ${new Date().toISOString()}`);
        await audit(db, workspace, 'Hosting request accepted', `${server.name} · ${value.action}`, 'info', id);
        if (value.action !== 'backup') await db.prepare("UPDATE servers SET status='unknown',players=0,player_list='[]',latency=NULL,last_checked=NULL WHERE id=?").run(id);
        await notify(db, workspace, 'Hosting request accepted', `${server.name} · ${value.action}`, 'info', 'hosting');
        return result;
      } finally {
        hostBusy.delete(id);
      }
    }
  };
}
