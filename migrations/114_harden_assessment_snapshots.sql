-- UP
-- Add constraints that were missing from the initial table creation

-- NOT NULL on score and band (a snapshot without a score is meaningless)
ALTER TABLE assessment_snapshots ALTER COLUMN overall_score SET NOT NULL;
ALTER TABLE assessment_snapshots ALTER COLUMN band SET NOT NULL;

-- Narrow varchar to match users.username width
ALTER TABLE assessment_snapshots ALTER COLUMN computed_by TYPE VARCHAR(100);
ALTER TABLE assessment_snapshots ALTER COLUMN signed_off_by TYPE VARCHAR(100);

-- Date ordering check
ALTER TABLE assessment_snapshots ADD CONSTRAINT chk_window_order
  CHECK (window_from IS NULL OR window_to IS NULL OR window_from <= window_to);

-- Deduplication: prevent identical snapshots (same home, engine, input data)
CREATE UNIQUE INDEX IF NOT EXISTS idx_assessment_snapshots_dedup
  ON assessment_snapshots(home_id, engine, input_hash) WHERE input_hash IS NOT NULL;

-- DOWN
ALTER TABLE assessment_snapshots ALTER COLUMN overall_score DROP NOT NULL;
ALTER TABLE assessment_snapshots ALTER COLUMN band DROP NOT NULL;
ALTER TABLE assessment_snapshots ALTER COLUMN computed_by TYPE VARCHAR(200);
ALTER TABLE assessment_snapshots ALTER COLUMN signed_off_by TYPE VARCHAR(200);
ALTER TABLE assessment_snapshots DROP CONSTRAINT IF EXISTS chk_window_order;
DROP INDEX IF EXISTS idx_assessment_snapshots_dedup;
