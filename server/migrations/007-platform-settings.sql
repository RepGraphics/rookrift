CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
