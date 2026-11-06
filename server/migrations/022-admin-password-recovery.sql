CREATE TABLE temporary_passwords (
 user_id TEXT PRIMARY KEY REFERENCES local_accounts(user_id) ON DELETE CASCADE,
 expires_at BIGINT NOT NULL,
 created_at BIGINT NOT NULL
);
CREATE TABLE password_change_challenges (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 credential_hash TEXT NOT NULL,
 totp_verified INTEGER NOT NULL DEFAULT 0,
 expires_at BIGINT NOT NULL
);
CREATE INDEX idx_password_change_user ON password_change_challenges(user_id);
CREATE TABLE admin_password_operations (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 method TEXT NOT NULL,
 created_at BIGINT NOT NULL
);
