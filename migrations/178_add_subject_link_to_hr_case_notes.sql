-- UP
-- Add first-class subject linkage to HR case notes so GDPR/SAR workflows
-- can use stable identifiers instead of falling back to name matching.

ALTER TABLE hr_case_notes
  ADD COLUMN IF NOT EXISTS subject_type VARCHAR(20)
    CHECK (subject_type IS NULL OR subject_type IN ('staff', 'resident')),
  ADD COLUMN IF NOT EXISTS subject_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_hr_case_notes_subject
  ON hr_case_notes(home_id, subject_type, subject_id)
  WHERE deleted_at IS NULL AND subject_id IS NOT NULL;

-- DOWN
DROP INDEX IF EXISTS idx_hr_case_notes_subject;
ALTER TABLE hr_case_notes
  DROP COLUMN IF EXISTS subject_id,
  DROP COLUMN IF EXISTS subject_type;
