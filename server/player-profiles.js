import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { tryIdentity, identityFromKey } from '../shared/ban-identity.js';
import { effectivePlan } from './plans.js';
import { staffAudit } from './team.js';
const fail = (message, status = 404) => Object.assign(new Error(message), {
  status
});
const scopeSql = '(?::text IS NULL OR o.server_id IN (SELECT json_array_elements_text(?::json)))';
const scopeArgs = ids => {
  const value = ids === null ? null : JSON.stringify(ids);
  return [value, value];
};
export async function observePlayers(db, server, lines, now = Date.now()) {
  const seen = new Set(),
    rows = [];
  for (const line of lines) {
    if (typeof line !== 'string') continue;
    const comma = line.lastIndexOf(',');
    if (comma < 0) continue;
    const identity = tryIdentity(line.slice(comma + 1).trim(),server.game==='dayz'?'battleye':server.game==='minecraft'?'minecraft':'auto');
    if (!identity || seen.has(identity.key)) continue;
    seen.add(identity.key);
    rows.push({
      id: randomUUID(),
      key: identity.key,
      kind: identity.kind,
      name: line.slice(0, comma).trim().slice(0, 200)
    });
  }
  await db.transaction(async () => {
    await db.prepare('UPDATE player_observations SET online=0 WHERE server_id=?').run(server.id);
    if (!rows.length) return;
    const json = JSON.stringify(rows);
    await db.prepare('INSERT INTO player_profiles SELECT x.id,?,x.key,x.kind,?,? FROM jsonb_to_recordset(?::jsonb) AS x(id text,key text,kind text,name text) ON CONFLICT(workspace_id,identity_key,game) DO NOTHING').run(server.workspace_id, server.game, now, json);
    await db.prepare('INSERT INTO player_observations SELECT p.id,?,x.name,?,?,?,1,1 FROM jsonb_to_recordset(?::jsonb) AS x(id text,key text,kind text,name text) JOIN player_profiles p ON p.identity_key=x.key AND p.workspace_id=? AND p.game=? ON CONFLICT(profile_id,server_id) DO UPDATE SET display_name=excluded.display_name,last_seen=GREATEST(player_observations.last_seen,excluded.last_seen),sightings=player_observations.sightings+CASE WHEN player_observations.last_checked=excluded.last_checked THEN 0 ELSE 1 END,last_checked=excluded.last_checked,online=1').run(server.id, now, now, now, json, server.workspace_id, server.game);
  });
}
export function createPlayerProfiles(db) {
  async function observations(workspace, id, ids) {
    return await db.prepare(`SELECT o.*,s.name AS server_name,s.cluster,s.game,s.status FROM player_observations o JOIN player_profiles p ON p.id=o.profile_id JOIN servers s ON s.id=o.server_id WHERE p.workspace_id=? AND p.id=? AND ${scopeSql} ORDER BY o.last_seen DESC,o.server_id`).all(workspace, id, ...scopeArgs(ids));
  }
  async function get(workspace, id, ids) {
    const row = await db.prepare('SELECT * FROM player_profiles WHERE id=? AND workspace_id=?').get(id, workspace),
      observed = await observations(workspace, id, ids);
    if (!row || !observed.length) throw fail('Player profile not found.');
    return {
      row,
      observed
    };
  }
  async function activeServers(workspace) {
    const ws = await db.prepare('SELECT * FROM workspaces WHERE id=?').get(workspace);
    return (await db.prepare('SELECT id FROM servers WHERE workspace_id=? ORDER BY created_at,id LIMIT ?').all(workspace, effectivePlan(ws).servers)).map(row => row.id);
  }
  const serialize = row => {
    const identity = identityFromKey(row.identity_key);
    const {
      identity_key,
      workspace_id,
      ...rest
    } = row;
    return {
      ...rest,
      identifier: identity.display,
      identity_kind: identity.kind,
      online: Boolean(row.online)
    };
  };
  return {
    async list(workspace, input = {}, ids = null) {
      const value = z.object({
          search: z.string().trim().max(140).default(''),
          game: z.enum(['all','asa','ase','minecraft','dayz']).default('all'),
          state: z.enum(['all', 'online', 'offline']).default('all'),
          page: z.coerce.number().int().min(1).max(10000).default(1)
        }).strict().parse(input),
        term = `%${value.search.replace(/[\\%_]/g, '\\$&')}%`,
        active = JSON.stringify(await activeServers(workspace));
      const cte = `WITH visible AS (SELECT p.id,p.identity_key,p.identity_kind,p.game,o.server_id,o.display_name,o.first_seen,o.last_seen,o.sightings,CASE WHEN o.online=1 AND s.status='online' AND s.game=p.game AND o.server_id IN(SELECT json_array_elements_text(?::json)) THEN 1 ELSE 0 END AS online FROM player_profiles p JOIN player_observations o ON o.profile_id=p.id JOIN servers s ON s.id=o.server_id WHERE p.workspace_id=? AND ${scopeSql} AND (?='all' OR p.game=?)),grouped AS (SELECT id,identity_key,identity_kind,game,MIN(first_seen) AS first_seen,MAX(last_seen) AS last_seen,SUM(sightings) AS sightings,COUNT(*) AS server_count,MAX(online) AS online FROM visible GROUP BY id,identity_key,identity_kind,game),filtered AS (SELECT g.*,(SELECT display_name FROM visible v WHERE v.id=g.id ORDER BY last_seen DESC,server_id LIMIT 1) AS name FROM grouped g WHERE (?='all' OR (?='online' AND online=1) OR (?='offline' AND online=0)) AND EXISTS(SELECT 1 FROM visible v WHERE v.id=g.id AND (v.display_name LIKE ? ESCAPE '\\' OR v.identity_key LIKE ? ESCAPE '\\'))) `;
      const params = [active, workspace, ...scopeArgs(ids), value.game, value.game, value.state, value.state, value.state, term, term];
      const total = (await db.prepare(cte + 'SELECT count(*) AS n FROM filtered').get(...params)).n;
      return {
        items: (await db.prepare(cte + 'SELECT * FROM filtered ORDER BY online DESC,last_seen DESC,id LIMIT 25 OFFSET ?').all(...params, (value.page - 1) * 25)).map(serialize),
        total,
        page: value.page,
        page_size: 25,
        has_more: value.page * 25 < total
      };
    },
    async detail(workspace, id, ids = null) {
      const {
          row,
          observed
        } = await get(workspace, id, ids),
        active = new Set(await activeServers(workspace));
      const servers = observed.map(({
        profile_id,
        status,
        online,
        ...entry
      }) => ({
        ...entry,
        online: Boolean(online && status === 'online' && active.has(entry.server_id) && entry.game === row.game)
      }));
      const visible = JSON.stringify(servers.map(s => s.server_id));
      return {
        ...serialize({
          ...row,
          name: observed[0].display_name,
          online: servers.some(s => s.online),
          first_seen: Math.min(...servers.map(s => s.first_seen)),
          last_seen: Math.max(...servers.map(s => s.last_seen)),
          server_count: servers.length,
          sightings: servers.reduce((n, s) => n + s.sightings, 0)
        }),
        servers,
        notes: await db.prepare('SELECT id,server_id,body,author_id,author_name,created_at,updated_at FROM player_notes WHERE profile_id=? AND workspace_id=? AND server_id IN(SELECT json_array_elements_text(?::json)) ORDER BY created_at DESC,id DESC').all(id, workspace, visible),
        moderation: await db.prepare('SELECT m.id,m.server_id,s.name AS server_name,m.action,m.reason,m.actor,m.active,m.created_at FROM moderation m JOIN servers s ON s.id=m.server_id WHERE m.workspace_id=? AND m.identity_key=? AND s.game=? AND m.server_id IN(SELECT json_array_elements_text(?::json)) ORDER BY m.created_at DESC,m.id DESC LIMIT 100').all(workspace, row.identity_key, row.game, visible)
      };
    },
    async addNote(workspace, id, input, user, ids = null) {
      const value = z.object({
          server_id: z.string().uuid(),
          body: z.string().trim().min(1).max(2000)
        }).strict().parse(input),
        {
          observed
        } = await get(workspace, id, ids);
      if (!observed.some(row => row.server_id === value.server_id)) throw fail('Choose an observed server you can access.');
      const note = randomUUID(),
        now = Date.now();
      await db.prepare('INSERT INTO player_notes VALUES(?,?,?,?,?,?,?,?,?)').run(note, workspace, id, value.server_id, value.body, user.id, user.name, now, now);
      await staffAudit(db, workspace, user, 'Added private player note', id, value.server_id);
      return {
        id: note
      };
    },
    async updateNote(workspace, profile, id, input, user, access) {
      const value = z.object({
          body: z.string().trim().min(1).max(2000)
        }).strict().parse(input),
        {
          observed
        } = await get(workspace, profile, access.server_ids),
        note = await db.prepare('SELECT * FROM player_notes WHERE id=? AND profile_id=? AND workspace_id=?').get(id, profile, workspace);
      if (!note || !observed.some(row => row.server_id === note.server_id)) throw fail('Note not found.');
      if (!['owner', 'admin'].includes(access.role) && note.author_id !== user.id) throw fail('Only the author or an administrator can edit this note.', 403);
      await db.prepare('UPDATE player_notes SET body=?,updated_at=? WHERE id=?').run(value.body, Date.now(), id);
      await staffAudit(db, workspace, user, 'Edited private player note', profile, note.server_id);
      return {
        ok: true
      };
    },
    async deleteNote(workspace, profile, id, user, access) {
      const {
          observed
        } = await get(workspace, profile, access.server_ids),
        note = await db.prepare('SELECT * FROM player_notes WHERE id=? AND profile_id=? AND workspace_id=?').get(id, profile, workspace);
      if (!note || !observed.some(row => row.server_id === note.server_id)) throw fail('Note not found.');
      if (!['owner', 'admin'].includes(access.role) && note.author_id !== user.id) throw fail('Only the author or an administrator can remove this note.', 403);
      await db.prepare('DELETE FROM player_notes WHERE id=?').run(id);
      await staffAudit(db, workspace, user, 'Removed private player note', profile, note.server_id);
      return {
        ok: true
      };
    }
  };
}
