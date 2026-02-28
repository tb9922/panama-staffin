-- UP
-- Add updated_at to supervisions, appraisals, fire_drills for optimistic locking.
-- care_certificates already has updated_at. training_records already has updated_at.

ALTER TABLE supervisions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE appraisals   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE fire_drills  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- DOWN
ALTER TABLE supervisions DROP COLUMN IF EXISTS updated_at;
ALTER TABLE appraisals   DROP COLUMN IF EXISTS updated_at;
ALTER TABLE fire_drills  DROP COLUMN IF EXISTS updated_at;
