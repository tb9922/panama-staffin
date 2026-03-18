-- UP
-- Add resident_id FK to incidents and complaints for canonical resident identity.
-- Enables robust SAR/erasure matching without name-collision risk.
-- person_affected_name / raised_by_name retained for display and backward compat.

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS resident_id INTEGER REFERENCES finance_residents(id) ON DELETE SET NULL;

ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS resident_id INTEGER REFERENCES finance_residents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_resident_id
  ON incidents(home_id, resident_id) WHERE deleted_at IS NULL AND resident_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_complaints_resident_id
  ON complaints(home_id, resident_id) WHERE deleted_at IS NULL AND resident_id IS NOT NULL;

-- Backfill: link existing records where person_affected is a resident
UPDATE incidents i SET resident_id = fr.id
  FROM finance_residents fr
  WHERE i.home_id = fr.home_id AND i.person_affected_name = fr.resident_name
    AND i.person_affected = 'resident' AND i.resident_id IS NULL AND fr.deleted_at IS NULL;

UPDATE complaints c SET resident_id = fr.id
  FROM finance_residents fr
  WHERE c.home_id = fr.home_id AND c.raised_by_name = fr.resident_name
    AND c.resident_id IS NULL AND fr.deleted_at IS NULL;

-- DOWN
DROP INDEX IF EXISTS idx_complaints_resident_id;
DROP INDEX IF EXISTS idx_incidents_resident_id;
ALTER TABLE complaints DROP COLUMN IF EXISTS resident_id;
ALTER TABLE incidents DROP COLUMN IF EXISTS resident_id;
