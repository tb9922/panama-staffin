BEGIN;

CREATE TABLE staff_auth_credentials (
  home_id            INTEGER NOT NULL,
  staff_id           VARCHAR(20) NOT NULL,
  username           VARCHAR(100) NOT NULL,
  password_hash      VARCHAR(255) NOT NULL,
  last_login_at      TIMESTAMPTZ,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until       TIMESTAMPTZ,
  session_version    INTEGER NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (home_id, staff_id),
  FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_staff_auth_username
  ON staff_auth_credentials (LOWER(username));

CREATE TABLE staff_invite_tokens (
  token       VARCHAR(64) PRIMARY KEY,
  home_id     INTEGER NOT NULL,
  staff_id    VARCHAR(20) NOT NULL,
  created_by  VARCHAR(100) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_staff_invite_tokens_open
  ON staff_invite_tokens (home_id, staff_id, expires_at)
  WHERE consumed_at IS NULL;

COMMIT;
