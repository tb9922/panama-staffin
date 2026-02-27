-- UP
-- Add soft-delete to complaint_surveys (CQC Reg 16 satisfaction survey evidence).
-- Aligns with the soft-delete pattern on all other compliance tables.

ALTER TABLE complaint_surveys ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_complaint_surveys_home_active
  ON complaint_surveys(home_id) WHERE deleted_at IS NULL;

-- DOWN
DROP INDEX IF EXISTS idx_complaint_surveys_home_active;
ALTER TABLE complaint_surveys DROP COLUMN IF EXISTS deleted_at;
