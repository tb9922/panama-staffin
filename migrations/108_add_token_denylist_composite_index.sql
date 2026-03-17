-- UP
CREATE INDEX IF NOT EXISTS idx_token_denylist_username_scope
  ON token_denylist(username, scope);

-- DOWN
DROP INDEX IF EXISTS idx_token_denylist_username_scope;
