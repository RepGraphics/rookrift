CREATE TABLE community_sites (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), slug TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', rules TEXT NOT NULL DEFAULT '',
 discord_url TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0,
 applications_open INTEGER NOT NULL DEFAULT 0, questions TEXT NOT NULL DEFAULT '[]',
 server_ids TEXT NOT NULL DEFAULT '[]', updated_at BIGINT NOT NULL
);
CREATE TABLE community_posts (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 title TEXT NOT NULL, body TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0,
 created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE community_events (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 title TEXT NOT NULL, body TEXT NOT NULL, starts_at BIGINT NOT NULL, ends_at BIGINT NOT NULL,
 capacity INTEGER NOT NULL DEFAULT 0, cancelled INTEGER NOT NULL DEFAULT 0,
 created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE community_rsvps (
 event_id TEXT NOT NULL REFERENCES community_events(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id), created_at BIGINT NOT NULL,
 PRIMARY KEY(event_id,user_id)
);
CREATE TABLE community_applications (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('join','staff')),
 game TEXT NOT NULL CHECK(game IN ('asa','ase')), identifier TEXT NOT NULL,
 answers TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined','withdrawn')),
 decision_message TEXT NOT NULL DEFAULT '', reviewed_by TEXT, reviewed_at BIGINT, created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX idx_pending_application ON community_applications(workspace_id,user_id,kind) WHERE status='pending';
CREATE INDEX idx_community_posts ON community_posts(workspace_id,created_at DESC);
CREATE INDEX idx_community_events ON community_events(workspace_id,starts_at);
CREATE INDEX idx_community_applications ON community_applications(workspace_id,status,created_at DESC);
CREATE INDEX idx_applicant_history ON community_applications(workspace_id,user_id,created_at DESC);
ALTER TABLE schedules ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'interval';
ALTER TABLE schedules ADD COLUMN days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]';
ALTER TABLE schedules ADD COLUMN start_time TEXT NOT NULL DEFAULT '04:00';
ALTER TABLE schedules ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE schedules DROP CONSTRAINT schedules_action_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_action_check CHECK(action IN ('save','broadcast','backup'));
