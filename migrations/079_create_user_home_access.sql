-- UP
-- Per-home authorization: restrict which users can access which homes.
-- Security boundary for multi-home deployments (GDPR Article 9 data).

CREATE TABLE IF NOT EXISTS user_home_access (
  id         SERIAL       PRIMARY KEY,
  username   VARCHAR(100) NOT NULL,
  home_id    INTEGER      NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(username, home_id)
);

CREATE INDEX IF NOT EXISTS idx_user_home_access_username
  ON user_home_access(username);

-- Seed: grant admin access to all existing homes so current deployments
-- continue working immediately after migration.
INSERT INTO user_home_access (username, home_id)
  SELECT 'admin', id FROM homes
  ON CONFLICT DO NOTHING;

-- DOWN
DROP TABLE IF EXISTS user_home_access;
