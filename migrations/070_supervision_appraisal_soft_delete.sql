-- UP
-- Add soft-delete to supervisions and appraisals (CQC Reg 18 HR evidence).
-- These are regulated records — hard deletes removed compliant records permanently.
-- Soft-delete matches the pattern on all other compliance tables.

ALTER TABLE supervisions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE appraisals  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial indexes: hot-path queries always filter WHERE deleted_at IS NULL
CREATE INDEX IF NOT EXISTS idx_supervisions_home_active
  ON supervisions(home_id, staff_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_appraisals_home_active
  ON appraisals(home_id, staff_id) WHERE deleted_at IS NULL;

-- DOWN
DROP INDEX IF EXISTS idx_supervisions_home_active;
DROP INDEX IF EXISTS idx_appraisals_home_active;
ALTER TABLE supervisions DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE appraisals  DROP COLUMN IF EXISTS deleted_at;
