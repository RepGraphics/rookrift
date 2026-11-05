CREATE TABLE local_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
