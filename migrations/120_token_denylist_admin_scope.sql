-- Migration 120: Add 'admin' scope to token_denylist
-- Allows admin-initiated revocations to survive user re-login (clearForUser preserves them)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'token_denylist_scope_check'
  ) THEN
    ALTER TABLE token_denylist DROP CONSTRAINT token_denylist_scope_check;
    ALTER TABLE token_denylist
      ADD CONSTRAINT token_denylist_scope_check CHECK (scope IN ('token', 'user', 'admin'));
  END IF;
END $$;

-- Rollback: remove 'admin' scope (first delete any admin-scope entries)
-- DELETE FROM token_denylist WHERE scope = 'admin';
-- ALTER TABLE token_denylist DROP CONSTRAINT token_denylist_scope_check;
-- ALTER TABLE token_denylist ADD CONSTRAINT token_denylist_scope_check CHECK (scope IN ('token', 'user'));
