-- Add optimistic concurrency fields to grievance actions.
ALTER TABLE hr_grievance_actions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

UPDATE hr_grievance_actions
SET updated_at = COALESCE(updated_at, created_at, NOW()),
    version = COALESCE(version, 1);

DROP TRIGGER IF EXISTS trg_updated_at_hr_grievance_actions ON hr_grievance_actions;
CREATE TRIGGER trg_updated_at_hr_grievance_actions
  BEFORE UPDATE ON hr_grievance_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
