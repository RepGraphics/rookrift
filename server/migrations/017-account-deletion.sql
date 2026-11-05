ALTER TABLE users ADD COLUMN deleting_at BIGINT;
ALTER TABLE workspaces ADD COLUMN closed_at BIGINT;
ALTER TABLE store_orders ADD COLUMN checkout_attempted_at BIGINT;
UPDATE store_orders SET checkout_attempted_at=created_at WHERE payment_status='pending' AND payment_provider='stripe' AND amount>0 AND checkout_session_id IS NULL;
CREATE TABLE account_deletion_proofs (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_token_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 method TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE account_deletion_challenges (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_token_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('passkey','discord')),challenge TEXT NOT NULL,expires_at BIGINT NOT NULL
);
CREATE TABLE billing_checkout_attempts (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),provider TEXT NOT NULL,
 external_id TEXT,plan TEXT NOT NULL,checkout_url TEXT,state TEXT NOT NULL DEFAULT 'creating',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
);
CREATE INDEX idx_billing_checkout_attempts ON billing_checkout_attempts(workspace_id,provider,state);
