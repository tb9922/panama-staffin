-- UP
-- Add evidence_ref column to training_records.
-- Frontend sends this field (TrainingRecordModal) but it was silently dropped
-- by both the Zod schema and the missing DB column.

ALTER TABLE training_records ADD COLUMN IF NOT EXISTS evidence_ref TEXT;

-- DOWN
ALTER TABLE training_records DROP COLUMN IF EXISTS evidence_ref;
