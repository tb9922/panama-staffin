-- Operational resilience hardening:
-- - Persistent Idempotency-Key storage for critical POST endpoints.
-- - Cheap purge index for expired request keys.

CREATE TABLE IF NOT EXISTS request_idempotency (
  id                BIGSERIAL PRIMARY KEY,
  scope             TEXT        NOT NULL,
  idempotency_key   TEXT        NOT NULL,
  request_hash      TEXT        NOT NULL,
  home_id           INTEGER     NOT NULL DEFAULT 0,
  user_name         TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),
  response_status   INTEGER,
  response_body     JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  UNIQUE (scope, idempotency_key, home_id, user_name)
);

CREATE INDEX IF NOT EXISTS idx_request_idempotency_expires
  ON request_idempotency(expires_at);
