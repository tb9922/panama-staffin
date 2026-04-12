CREATE TABLE IF NOT EXISTS rate_limit_hits (
  key         TEXT PRIMARY KEY,
  hits        INTEGER      NOT NULL DEFAULT 0 CHECK (hits >= 0),
  reset_at    TIMESTAMPTZ  NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_reset_at
  ON rate_limit_hits(reset_at);
