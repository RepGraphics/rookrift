ALTER TABLE servers ADD COLUMN IF NOT EXISTS link_ingest_token_hash TEXT;
CREATE TABLE community_link_codes (
  code_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game TEXT NOT NULL CHECK(game IN ('asa','ase','dayz')),
  expires_at BIGINT NOT NULL,
  used_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX idx_community_link_codes_expiry ON community_link_codes(expires_at);
