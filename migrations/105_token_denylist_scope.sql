-- UP
-- Add scope column to distinguish single-token logout from user-wide revocation.
-- Previously isDenied() used OR logic on both jti and username, causing a single
-- logout to block ALL sessions for that username.

ALTER TABLE token_denylist
  ADD COLUMN IF NOT EXISTS scope VARCHAR(10) NOT NULL DEFAULT 'token';

-- Add CHECK constraint separately (IF NOT EXISTS not supported on constraints)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'token_denylist_scope_check'
  ) THEN
    ALTER TABLE token_denylist
      ADD CONSTRAINT token_denylist_scope_check CHECK (scope IN ('token', 'user'));
  END IF;
END $$;

-- DOWN
ALTER TABLE token_denylist DROP COLUMN IF EXISTS scope;
