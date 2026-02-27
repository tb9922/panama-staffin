-- UP
-- Token deny-list for immediate JWT revocation (e.g. terminated staff).
-- Entries auto-expire when the original JWT would have expired.
-- Pruned periodically to avoid unbounded growth.

CREATE TABLE IF NOT EXISTS token_denylist (
  jti           UUID           PRIMARY KEY,
  username      VARCHAR(100)   NOT NULL,
  revoked_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ    NOT NULL
);

-- Fast lookup on every authenticated request
CREATE INDEX IF NOT EXISTS idx_token_denylist_expires
  ON token_denylist(expires_at);

-- Prune by username when revoking all tokens for a user
CREATE INDEX IF NOT EXISTS idx_token_denylist_username
  ON token_denylist(username);

-- DOWN
DROP TABLE IF EXISTS token_denylist;
