CREATE TABLE player_presence_checks (
 server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 checked_at BIGINT NOT NULL,
 connected INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE player_sessions (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
 profile_id TEXT NOT NULL REFERENCES player_profiles(id) ON DELETE CASCADE,
 display_name TEXT NOT NULL,
 started_at BIGINT NOT NULL,
 last_seen BIGINT NOT NULL,
 samples INTEGER NOT NULL DEFAULT 1,
 start_reason TEXT NOT NULL CHECK(start_reason IN ('baseline','appeared','resumed')),
 ended_at BIGINT,
 end_detected_at BIGINT,
 end_reason TEXT CHECK(end_reason IN ('not_seen','connection_lost','monitoring_gap','monitoring_restarted','connection_changed','monitoring_paused','unreliable_snapshot')),
 CHECK(last_seen>=started_at),
 CHECK((ended_at IS NULL AND end_detected_at IS NULL AND end_reason IS NULL) OR (ended_at=last_seen AND end_detected_at>=ended_at AND end_reason IS NOT NULL))
);
CREATE UNIQUE INDEX idx_player_sessions_open ON player_sessions(server_id,profile_id) WHERE ended_at IS NULL;
CREATE INDEX idx_player_sessions_workspace ON player_sessions(workspace_id,last_seen DESC,id);
CREATE INDEX idx_player_sessions_profile ON player_sessions(profile_id,last_seen DESC);
CREATE INDEX idx_player_sessions_events ON player_sessions(workspace_id,end_detected_at DESC) WHERE ended_at IS NOT NULL;
