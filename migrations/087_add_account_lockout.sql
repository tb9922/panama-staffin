-- UP
-- Add account lockout columns for brute-force protection
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP;

-- DOWN
ALTER TABLE users DROP COLUMN IF EXISTS failed_login_count;
ALTER TABLE users DROP COLUMN IF EXISTS locked_until;
