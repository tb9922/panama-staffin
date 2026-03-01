-- UP
-- Database-backed users replacing hardcoded env-var credentials.
-- Existing user_home_access table already uses username VARCHAR(100) as key.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL       PRIMARY KEY,
  username      VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL CHECK (role IN ('admin', 'viewer')),
  display_name  VARCHAR(200) NOT NULL DEFAULT '',
  active        BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  created_by    VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_users_active ON users(active) WHERE active = true;

-- DOWN
DROP TABLE IF EXISTS users;
