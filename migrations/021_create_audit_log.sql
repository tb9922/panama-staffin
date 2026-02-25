-- UP
-- audit_log: replaces audit_log.json. DB-backed for durability, queryability,
-- and no 500-entry cap. home_slug used (not FK) so audit entries survive home renames.

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL     PRIMARY KEY,
  ts         TIMESTAMP     NOT NULL DEFAULT NOW(),
  action     VARCHAR(50)   NOT NULL,
  home_slug  VARCHAR(100),
  user_name  VARCHAR(100),
  details    TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_ts
  ON audit_log(ts DESC);

CREATE INDEX IF NOT EXISTS idx_audit_home_ts
  ON audit_log(home_slug, ts DESC);

-- DOWN
DROP TABLE IF EXISTS audit_log;
