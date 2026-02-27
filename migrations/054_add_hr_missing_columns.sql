-- UP
-- Fix MEDIUM/LOW HR review issues:
-- 1. hr_grievance_actions missing home_id (cross-tenant gap)
-- 2. hr_oh_referrals missing status column
-- 3. Six tables missing created_by audit column

-- 1a. Add home_id to hr_grievance_actions
ALTER TABLE hr_grievance_actions ADD COLUMN IF NOT EXISTS home_id INTEGER;

-- 1b. Backfill from parent grievance case
UPDATE hr_grievance_actions SET home_id = g.home_id
  FROM hr_grievance_cases g
  WHERE hr_grievance_actions.grievance_id = g.id
    AND hr_grievance_actions.home_id IS NULL;

-- 1c. Set NOT NULL after backfill
ALTER TABLE hr_grievance_actions ALTER COLUMN home_id SET NOT NULL;

-- 1d. Add FK constraint
ALTER TABLE hr_grievance_actions DROP CONSTRAINT IF EXISTS hr_grievance_actions_home_id_fkey;
ALTER TABLE hr_grievance_actions ADD CONSTRAINT hr_grievance_actions_home_id_fkey
  FOREIGN KEY (home_id) REFERENCES homes(id);

-- 1e. Add index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_hr_grv_actions_home
  ON hr_grievance_actions(home_id);

-- 2. Add status to hr_oh_referrals
ALTER TABLE hr_oh_referrals ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'pending';
ALTER TABLE hr_oh_referrals DROP CONSTRAINT IF EXISTS hr_oh_referrals_status_check;
ALTER TABLE hr_oh_referrals ADD CONSTRAINT hr_oh_referrals_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));

-- 3. Add created_by to tables missing it
ALTER TABLE hr_performance_cases ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
ALTER TABLE hr_rtw_interviews ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
ALTER TABLE hr_oh_referrals ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
ALTER TABLE hr_family_leave ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
ALTER TABLE hr_flexible_working ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
ALTER TABLE hr_tupe_transfers ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);

-- DOWN
DROP INDEX IF EXISTS idx_hr_grv_actions_home;
ALTER TABLE hr_grievance_actions DROP CONSTRAINT IF EXISTS hr_grievance_actions_home_id_fkey;
ALTER TABLE hr_grievance_actions DROP COLUMN IF EXISTS home_id;

ALTER TABLE hr_oh_referrals DROP CONSTRAINT IF EXISTS hr_oh_referrals_status_check;
ALTER TABLE hr_oh_referrals DROP COLUMN IF EXISTS status;

-- Only drop created_by from tables that didn't have it originally (044, 045, 048, 050)
ALTER TABLE hr_rtw_interviews DROP COLUMN IF EXISTS created_by;
ALTER TABLE hr_oh_referrals DROP COLUMN IF EXISTS created_by;
ALTER TABLE hr_flexible_working DROP COLUMN IF EXISTS created_by;
ALTER TABLE hr_tupe_transfers DROP COLUMN IF EXISTS created_by;
