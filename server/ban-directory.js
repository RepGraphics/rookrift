import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { normalizeIdentity, identityFromKey, ID_KINDS } from '../shared/ban-identity.js';
import { audit } from './db.js';
export const banLookupSchema = z.object({
  identifier: z.string().trim().min(3).max(140),
  identity_kind: z.enum(ID_KINDS).default('auto'),
  game: z.enum(['all','asa','ase','minecraft','dayz']).default('all'),
  include_withdrawn: z.boolean().default(false),
  page: z.coerce.number().int().min(1).max(10000).default(1)
}).strict();
const pageSize = 25;
const groupId = (workspace, key, cluster, game) => createHash('sha256').update(`${workspace}\0${key}\0${cluster}\0${game}`).digest('hex').slice(0, 24);
const clusterSql = alias => `CASE WHEN ${alias}.cluster='' THEN 'server:'||${alias}.id ELSE 'cluster:'||${alias}.cluster END`;
const clusterLabelSql = (alias, publicView = false) => `CASE WHEN ${alias}.cluster='' THEN ${publicView ? "'Unclustered server'" : `${alias}.name`} ELSE ${alias}.cluster END`;
export async function syncBanReports(db, workspaceId) {
  const workspace = await db.prepare('SELECT * FROM workspaces WHERE id=?').get(workspaceId);
  if (!workspace) return;
  const now = Date.now();
  await db.prepare(`UPDATE ban_directory_reports SET active=0,withdrawn_at=?,last_updated_at=? WHERE workspace_id=? AND active=1 AND NOT EXISTS(SELECT 1 FROM moderation m WHERE m.server_id=ban_directory_reports.server_id AND m.identity_key=ban_directory_reports.identity_key AND m.action='ban' AND m.active=1)`).run(now, now, workspaceId);
  if (!workspace.ban_sharing_enabled) return;
  const active = await db.prepare("SELECT server_id,identity_key,identity_kind,MIN(created_at) AS first_seen,MAX(created_at) AS last_seen FROM moderation WHERE workspace_id=? AND action='ban' AND active=1 GROUP BY server_id,identity_key,identity_kind").all(workspaceId);
  const upsert = db.prepare(`INSERT INTO ban_directory_reports VALUES(?,?,?,?,?,?,?,?,NULL) ON CONFLICT(server_id,identity_key) DO UPDATE SET active=1,identity_kind=excluded.identity_kind,last_updated_at=CASE WHEN ban_directory_reports.active=0 THEN excluded.last_updated_at ELSE GREATEST(ban_directory_reports.last_updated_at,excluded.last_updated_at) END,withdrawn_at=NULL`);
  for (const row of active) if (row.identity_key) await upsert.run(randomUUID(), workspaceId, row.server_id, row.identity_key, row.identity_kind, 1, row.first_seen, row.last_seen);
}
export function createBanDirectory(db) {
  async function preferences(workspaceId) {
    const row = await db.prepare('SELECT ban_sharing_enabled,ban_public_name,name FROM workspaces WHERE id=?').get(workspaceId);
    return {
      sharing_enabled: Boolean(row.ban_sharing_enabled),
      public_name: row.ban_public_name || row.name,
      shared_active_reports: (await db.prepare('SELECT count(*) AS n FROM ban_directory_reports WHERE workspace_id=? AND active=1').get(workspaceId)).n,
      participating_communities: (await db.prepare('SELECT count(*) AS n FROM workspaces WHERE ban_sharing_enabled=1').get()).n
    };
  }
  async function privateQuery(workspaceId, identityKey = null, game = 'all', status = 'active', page = 1, serverIds = null) {
    const cte = `WITH grouped AS (SELECT m.identity_key,m.identity_kind,${clusterSql('s')} AS cluster_key,${clusterLabelSql('s')} AS cluster,s.game,MAX(m.active) AS active,COUNT(DISTINCT s.id) AS server_count,COUNT(DISTINCT CASE WHEN m.active=1 THEN s.id END) AS active_servers,MIN(m.created_at) AS first_reported_at,MAX(GREATEST(m.created_at,COALESCE((SELECT MAX(u.created_at) FROM moderation u WHERE u.server_id=m.server_id AND u.identity_key=m.identity_key AND u.action='unban'),m.created_at))) AS last_updated_at FROM moderation m JOIN servers s ON s.id=m.server_id WHERE m.workspace_id=? AND m.action='ban' AND (?::text IS NULL OR s.id IN(SELECT json_array_elements_text(?::json))) AND (?::text IS NULL OR m.identity_key=?) AND (?='all' OR s.game=?) GROUP BY m.identity_key,m.identity_kind,cluster_key,${clusterLabelSql('s')},s.game), filtered AS (SELECT * FROM grouped WHERE (?='all' OR (?='active' AND active=1) OR (?='withdrawn' AND active=0))) `;
    const scope = serverIds === null ? null : JSON.stringify(serverIds);
    const parameters = [workspaceId, scope, scope, identityKey, identityKey, game, game, status, status, status];
    const total = (await db.prepare(cte + 'SELECT count(*) AS n FROM filtered').get(...parameters)).n;
    const rows = await db.prepare(cte + 'SELECT * FROM filtered ORDER BY active DESC,last_updated_at DESC,identity_key,cluster_key LIMIT ? OFFSET ?').all(...parameters, pageSize, (page - 1) * pageSize);
    return {
      items: rows.map(row => {
        let identity;
        try {
          identity = identityFromKey(row.identity_key);
        } catch {
          identity = {
            kind: row.identity_kind,
            display: row.identity_key?.split(':').slice(1).join(':') || 'Unknown'
          };
        }
        return {
          id: groupId(workspaceId, row.identity_key, row.cluster_key, row.game),
          identifier: identity.display,
          identity_kind: identity.kind,
          cluster: row.cluster,
          game: row.game,
          active: Boolean(row.active),
          server_count: row.server_count,
          active_servers: row.active_servers,
          first_reported_at: row.first_reported_at,
          last_updated_at: row.last_updated_at,
          evidence: 'command_acknowledged'
        };
      }),
      total,
      page,
      page_size: pageSize,
      has_more: page * pageSize < total
    };
  }
  return {
    preferences,
    async updatePreferences(workspaceId, input) {
      return await db.withWorkspaceLock(workspaceId, async () => {
        const value = z.object({
          sharing_enabled: z.boolean(),
          public_name: z.string().trim().min(2).max(60)
        }).strict().parse(input);
        await db.transaction(async () => {
          await db.prepare('UPDATE workspaces SET ban_sharing_enabled=?,ban_public_name=? WHERE id=?').run(Number(value.sharing_enabled), value.public_name, workspaceId);
          await syncBanReports(db, workspaceId);
          await audit(db, workspaceId, value.sharing_enabled ? 'Community ban sharing enabled' : 'Community ban sharing disabled', 'Directory visibility preference updated.', 'info');
        });
        return await preferences(workspaceId);
      });
    },
    async ownBans(workspaceId, input = {}, serverIds = null) {
      const value = z.object({
        status: z.enum(['active', 'withdrawn', 'all']).default('active'),
        game: z.enum(['all','asa','ase','minecraft','dayz']).default('all'),
        page: z.coerce.number().int().min(1).max(10000).default(1)
      }).strict().parse(input);
      return await privateQuery(workspaceId, null, value.game, value.status, value.page, serverIds);
    },
    async lookup(workspaceId, input, serverIds = null) {
      const value = banLookupSchema.parse(input),
        identity = normalizeIdentity(value.identifier,value.identity_kind==='auto'&&['minecraft','dayz'].includes(value.game)?value.game==='dayz'?'battleye':'minecraft':value.identity_kind);
      const status = value.include_withdrawn ? 'all' : 'active';
      const own = await privateQuery(workspaceId, identity.key, value.game, status, value.page, serverIds);
      const cte = `WITH grouped AS (SELECT w.id AS source_id,w.ban_public_name AS community,${clusterSql('s')} AS cluster_key,${clusterLabelSql('s', true)} AS cluster,s.game,MAX(r.active) AS active,COUNT(DISTINCT s.id) AS server_count,COUNT(DISTINCT CASE WHEN r.active=1 THEN s.id END) AS active_servers,MIN(r.first_reported_at) AS first_reported_at,MAX(r.last_updated_at) AS last_updated_at,MAX(r.withdrawn_at) AS withdrawn_at FROM ban_directory_reports r JOIN workspaces w ON w.id=r.workspace_id JOIN servers s ON s.id=r.server_id WHERE w.ban_sharing_enabled=1 AND w.id<>? AND r.identity_key=? AND (?='all' OR s.game=?) GROUP BY w.id,cluster_key,${clusterLabelSql('s', true)},s.game),filtered AS (SELECT * FROM grouped WHERE ?=1 OR active=1) `;
      const parameters = [workspaceId, identity.key, value.game, value.game, Number(value.include_withdrawn)];
      const total = (await db.prepare(cte + 'SELECT count(*) AS n FROM filtered').get(...parameters)).n;
      const rows = await db.prepare(cte + 'SELECT * FROM filtered ORDER BY active DESC,last_updated_at DESC,source_id,cluster_key LIMIT ? OFFSET ?').all(...parameters, pageSize, (value.page - 1) * pageSize);
      const community = {
        items: rows.map(row => ({
          id: groupId(row.source_id, identity.key, row.cluster_key, row.game),
          community: row.community,
          cluster: row.cluster,
          game: row.game,
          active: Boolean(row.active),
          server_count: row.server_count,
          active_servers: row.active_servers,
          first_reported_at: row.first_reported_at,
          last_updated_at: row.last_updated_at,
          withdrawn_at: row.active ? null : row.withdrawn_at,
          evidence: 'community_report'
        })),
        total,
        page: value.page,
        page_size: pageSize,
        has_more: value.page * pageSize < total
      };
      return {
        identity: {
          kind: identity.kind,
          display: identity.display
        },
        game: value.game,
        own,
        community,
        coverage: {
          participating_communities: (await preferences(workspaceId)).participating_communities,
          source: 'Opt-in Rookrift communities only',
          verified_game_state: false
        },
        checked_at: Date.now()
      };
    }
  };
}
