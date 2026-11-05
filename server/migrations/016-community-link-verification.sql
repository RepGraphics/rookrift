ALTER TABLE community_link_codes ADD COLUMN server_id TEXT REFERENCES servers(id) ON DELETE CASCADE;
ALTER TABLE community_game_accounts ADD COLUMN verified_server_id TEXT REFERENCES servers(id) ON DELETE SET NULL;
ALTER TABLE community_game_accounts ADD COLUMN verified_at BIGINT;
-- Legacy name-only log parsing cannot establish the provenance now required.
-- Preserve saved identifiers and require a fresh verification instead.
UPDATE community_game_accounts SET verified=0 WHERE verified=1 AND verified_at IS NULL;
CREATE INDEX idx_community_link_pending_server ON community_link_codes(server_id,expires_at) WHERE used_at IS NULL;
