ALTER TABLE dp_complaints
  ADD COLUMN IF NOT EXISTS subject_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS subject_id VARCHAR(100);

ALTER TABLE dp_complaints
  DROP CONSTRAINT IF EXISTS dp_complaints_subject_type_check;

ALTER TABLE dp_complaints
  ADD CONSTRAINT dp_complaints_subject_type_check
  CHECK (subject_type IS NULL OR subject_type IN ('staff', 'resident'));

CREATE INDEX IF NOT EXISTS idx_dp_complaints_subject
  ON dp_complaints (home_id, subject_type, subject_id)
  WHERE deleted_at IS NULL AND subject_id IS NOT NULL;
