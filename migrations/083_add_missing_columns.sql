-- UP
-- Add missing columns discovered during integration testing.

-- payroll_runs: ytd_applied flag for approve-flow guard
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS ytd_applied BOOLEAN NOT NULL DEFAULT false;

-- data_requests: version column for optimistic locking (missed from 081)
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- hr_oh_referrals: notes column (referenced in repo but never migrated)
ALTER TABLE hr_oh_referrals ADD COLUMN IF NOT EXISTS notes TEXT;

-- DOWN
-- ALTER TABLE payroll_runs DROP COLUMN IF EXISTS ytd_applied;
-- ALTER TABLE data_requests DROP COLUMN IF EXISTS version;
-- ALTER TABLE hr_oh_referrals DROP COLUMN IF EXISTS notes;
