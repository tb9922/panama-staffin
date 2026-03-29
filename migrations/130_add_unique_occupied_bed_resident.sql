-- UP
-- Prevent a resident being assigned to more than one occupied bed in the same home.
-- Fail loudly if legacy duplicate occupied assignments already exist so they can be cleaned deliberately.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM beds
    WHERE status = 'occupied' AND resident_id IS NOT NULL
    GROUP BY home_id, resident_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add occupied-bed uniqueness index: duplicate occupied bed assignments already exist';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_beds_home_resident_occupied
  ON beds(home_id, resident_id)
  WHERE status = 'occupied' AND resident_id IS NOT NULL;

-- DOWN
DROP INDEX IF EXISTS uniq_beds_home_resident_occupied;
