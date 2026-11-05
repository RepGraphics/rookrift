CREATE TABLE login_challenges (
 token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 credential_hash TEXT NOT NULL,expires_at BIGINT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_login_challenges_user ON login_challenges(user_id);
CREATE TABLE email_outbox (
 id TEXT PRIMARY KEY,dedupe_key TEXT NOT NULL UNIQUE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,workspace_id TEXT,
 kind TEXT NOT NULL,payload TEXT,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at BIGINT NOT NULL,expires_at BIGINT NOT NULL,created_at BIGINT NOT NULL,sent_at BIGINT,last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_email_outbox_due ON email_outbox(status,next_attempt_at);
