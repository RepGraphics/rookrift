CREATE TABLE workflows (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE, name TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1, trigger_type TEXT NOT NULL, interval_minutes INTEGER NOT NULL,
 days TEXT NOT NULL, start_time TEXT NOT NULL, time_zone TEXT NOT NULL,
 cooldown_minutes INTEGER NOT NULL, steps TEXT NOT NULL, webhook_hash TEXT,
 next_run BIGINT, last_started_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE workflow_runs (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL, server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
 name TEXT NOT NULL, trigger_type TEXT NOT NULL, actor TEXT NOT NULL, source_key TEXT,
 status TEXT NOT NULL, steps TEXT NOT NULL, next_step INTEGER NOT NULL DEFAULT 0,
 next_step_at BIGINT NOT NULL, cancel_requested INTEGER NOT NULL DEFAULT 0,
 created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, finished_at BIGINT,
 UNIQUE(workflow_id,source_key)
);
CREATE UNIQUE INDEX idx_workflow_server_active ON workflow_runs(server_id) WHERE status IN ('queued','running','waiting');
CREATE INDEX idx_workflows_workspace ON workflows(workspace_id,created_at,id);
CREATE INDEX idx_workflow_trigger ON workflows(trigger_type,next_run) WHERE enabled=1;
CREATE INDEX idx_workflow_due ON workflow_runs(next_step_at) WHERE status IN ('queued','running','waiting');
CREATE INDEX idx_workflow_history ON workflow_runs(workspace_id,created_at DESC);
CREATE INDEX idx_workflow_finished ON workflow_runs(finished_at) WHERE finished_at IS NOT NULL;
CREATE TABLE workflow_events (
 workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
 source_key TEXT NOT NULL, run_id TEXT, created_at BIGINT NOT NULL,
 PRIMARY KEY(workflow_id,source_key)
);
CREATE INDEX idx_workflow_event_expiry ON workflow_events(created_at);
CREATE TABLE config_templates (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL,
 game TEXT NOT NULL CHECK(game IN ('asa','ase')), filename TEXT NOT NULL CHECK(filename IN ('Game.ini','GameUserSettings.ini')),
 current_revision INTEGER NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE config_versions (
 id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES config_templates(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, body TEXT NOT NULL, summary TEXT NOT NULL, actor TEXT NOT NULL, created_at BIGINT NOT NULL,
 UNIQUE(template_id,revision)
);
CREATE TABLE config_applications (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
 template_id TEXT REFERENCES config_templates(id) ON DELETE SET NULL, template_name TEXT NOT NULL, revision INTEGER NOT NULL,
 filename TEXT NOT NULL, path TEXT NOT NULL, target_hash TEXT NOT NULL,
 before_cipher TEXT NOT NULL, before_hash TEXT NOT NULL, after_hash TEXT NOT NULL,
 status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX idx_config_templates ON config_templates(workspace_id,created_at,id);
CREATE INDEX idx_config_history ON config_applications(workspace_id,created_at DESC);
CREATE UNIQUE INDEX idx_config_active ON config_applications(server_id) WHERE status IN ('applying','rolling_back');
