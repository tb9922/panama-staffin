-- UP
-- Harden assessment_snapshots: NOT NULL constraints, deduplication index, window ordering.

ALTER TABLE assessment_snapshots
  ALTER COLUMN overall_score SET NOT NULL,
  ALTER COLUMN band SET NOT NULL;

-- Deduplication: same home + engine + input_hash = duplicate snapshot
CREATE UNIQUE INDEX IF NOT EXISTS idx_assessment_snapshots_dedup
  ON assessment_snapshots(home_id, engine, input_hash)
  WHERE input_hash IS NOT NULL;

-- Ensure window_from <= window_to when both are set
ALTER TABLE assessment_snapshots
  ADD CONSTRAINT chk_assessment_window_order
  CHECK (window_from IS NULL OR window_to IS NULL OR window_from <= window_to);

-- DOWN
ALTER TABLE assessment_snapshots DROP CONSTRAINT IF EXISTS chk_assessment_window_order;
DROP INDEX IF EXISTS idx_assessment_snapshots_dedup;
ALTER TABLE assessment_snapshots
  ALTER COLUMN overall_score DROP NOT NULL,
  ALTER COLUMN band DROP NOT NULL;
