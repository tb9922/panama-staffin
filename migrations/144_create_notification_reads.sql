CREATE TABLE IF NOT EXISTS user_notification_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  home_id INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  notification_key VARCHAR(120) NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, home_id, notification_key)
);

CREATE INDEX IF NOT EXISTS idx_user_notification_reads_user_home
  ON user_notification_reads(user_id, home_id, read_at DESC);
