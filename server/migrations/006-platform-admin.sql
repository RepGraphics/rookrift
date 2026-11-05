CREATE TABLE IF NOT EXISTS platform_admins (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS suspended_users (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_impersonations (
  session_token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
  root_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL
);
