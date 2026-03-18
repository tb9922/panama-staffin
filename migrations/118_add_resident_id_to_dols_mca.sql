-- UP
-- Add resident_id FK to dols and mca_assessments for robust identity matching.
-- Prevents name-collision issues in SAR gathering and erasure.
-- resident_name retained for backward compat and display; resident_id is the canonical link.

ALTER TABLE dols
  ADD COLUMN IF NOT EXISTS resident_id INTEGER REFERENCES finance_residents(id) ON DELETE SET NULL;

ALTER TABLE mca_assessments
  ADD COLUMN IF NOT EXISTS resident_id INTEGER REFERENCES finance_residents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dols_resident_id
  ON dols(home_id, resident_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mca_resident_id
  ON mca_assessments(home_id, resident_id) WHERE deleted_at IS NULL;

-- Backfill: link existing records to finance_residents by matching name + home
UPDATE dols d SET resident_id = fr.id
  FROM finance_residents fr
  WHERE d.home_id = fr.home_id AND d.resident_name = fr.resident_name
    AND d.resident_id IS NULL AND fr.deleted_at IS NULL;

UPDATE mca_assessments m SET resident_id = fr.id
  FROM finance_residents fr
  WHERE m.home_id = fr.home_id AND m.resident_name = fr.resident_name
    AND m.resident_id IS NULL AND fr.deleted_at IS NULL;

-- DOWN
DROP INDEX IF EXISTS idx_mca_resident_id;
DROP INDEX IF EXISTS idx_dols_resident_id;
ALTER TABLE mca_assessments DROP COLUMN IF EXISTS resident_id;
ALTER TABLE dols DROP COLUMN IF EXISTS resident_id;
