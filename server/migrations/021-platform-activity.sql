CREATE TABLE platform_activity (
 id TEXT PRIMARY KEY,
 actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 target_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
 action TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '',
 created_at BIGINT NOT NULL
);
CREATE INDEX idx_platform_activity_created ON platform_activity(created_at DESC);
