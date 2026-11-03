import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export function openDatabase(filename = process.env.DATABASE_PATH || './data/rookrift.sqlite') {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT, access_token TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL UNIQUE REFERENCES users(id), name TEXT NOT NULL DEFAULT 'My community', plan TEXT NOT NULL DEFAULT 'scout', subscription_status TEXT NOT NULL DEFAULT 'free', customer_id TEXT UNIQUE, subscription_id TEXT UNIQUE, guild_id TEXT UNIQUE, guild_name TEXT, alert_channel_id TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_states (state_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, game TEXT NOT NULL CHECK(game IN ('asa','ase')), map TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, password TEXT NOT NULL, max_players INTEGER NOT NULL DEFAULT 70, status TEXT NOT NULL DEFAULT 'unknown', players INTEGER NOT NULL DEFAULT 0, latency INTEGER, last_checked INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE, name TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('save','broadcast')), message TEXT NOT NULL DEFAULT '', interval_minutes INTEGER NOT NULL, next_run INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), server_id TEXT, title TEXT NOT NULL, detail TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS metrics (server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE, players INTEGER NOT NULL, online INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_servers_workspace ON servers(workspace_id,created_at,id);
    CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity(workspace_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_metrics_time ON metrics(server_id,created_at);`);
  // Existing installations are upgraded in place; connection records and secrets survive.
  const columns = {
    servers: { cluster: "TEXT NOT NULL DEFAULT ''", maintenance: 'INTEGER NOT NULL DEFAULT 0', player_list: "TEXT NOT NULL DEFAULT '[]'", notes: "TEXT NOT NULL DEFAULT ''", failed_checks: 'INTEGER NOT NULL DEFAULT 0', failed_since: 'INTEGER' },
    schedules: { last_run: 'INTEGER', last_status: 'TEXT', last_detail: 'TEXT' },
    workspaces: { alerts_enabled: 'INTEGER NOT NULL DEFAULT 1', failure_threshold: 'INTEGER NOT NULL DEFAULT 1' },
    metrics: { latency: 'INTEGER' }
  };
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS announcement_templates (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),name TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS maintenance_windows (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),name TEXT NOT NULL,server_ids TEXT NOT NULL,days TEXT NOT NULL,start_time TEXT NOT NULL,duration_minutes INTEGER NOT NULL,time_zone TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),title TEXT NOT NULL,detail TEXT NOT NULL,level TEXT NOT NULL,target TEXT NOT NULL,source_key TEXT UNIQUE,created_at INTEGER NOT NULL,read_at INTEGER);
      CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,opened_at INTEGER NOT NULL,resolved_at INTEGER,acknowledged_at INTEGER,notes TEXT NOT NULL DEFAULT '');
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_incident ON incidents(server_id) WHERE resolved_at IS NULL;
      CREATE TABLE IF NOT EXISTS schedule_runs (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,started_at INTEGER NOT NULL,finished_at INTEGER NOT NULL,status TEXT NOT NULL,detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS moderation (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,identifier TEXT NOT NULL,player_name TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,actor TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_ban ON moderation(server_id,identifier) WHERE active=1;
      CREATE TABLE IF NOT EXISTS hosting_connections (server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL REFERENCES workspaces(id),provider TEXT NOT NULL,origin TEXT NOT NULL,remote_id TEXT NOT NULL,api_key TEXT NOT NULL,verified_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id,created_at);
      CREATE INDEX IF NOT EXISTS idx_runs_workspace ON schedule_runs(workspace_id,finished_at);
    `);
    for (const [table, additions] of Object.entries(columns)) {
      const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
      for (const [name, definition] of Object.entries(additions)) if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
    db.exec('PRAGMA user_version=2; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  return db;
}
export const listServers = (db, workspaceId) => db.prepare('SELECT * FROM servers WHERE workspace_id=? ORDER BY created_at,id').all(workspaceId);
export function publicServer(row, paused = false) {
  const { password, workspace_id, player_list, ...server } = row;
  return { ...server, maintenance: Boolean(server.maintenance), paused };
}
export function playerSnapshot(servers) {
  return servers.filter(server => server.status === 'online' && !server.paused).flatMap(server => {
    let players; try { players = JSON.parse(server.player_list || '[]'); } catch { players = []; }
    return (Array.isArray(players) ? players : []).slice(0, 1000).filter(line => typeof line === 'string').map((line, index) => {
      const separator = line.lastIndexOf(',');
      return { id: `${server.id}:${index}`, name: separator > -1 ? line.slice(0, separator).trim() : line, identifier: separator > -1 ? line.slice(separator + 1).trim() : '', server_id: server.id, server_name: server.name, game: server.game, cluster: server.cluster, checked_at: server.last_checked };
    });
  });
}
export function audit(db, workspace, title, detail, level = 'info', server = null) {
  db.prepare('INSERT INTO activity VALUES(?,?,?,?,?,?,?)').run(randomUUID(), workspace, server, title, detail.slice(0, 1500), level, Date.now());
}
