-- UP
-- Add FK from incident_addenda to incidents (composite key: home_id + incident_id).
-- Prevents orphaned addenda and cross-home addendum injection.
-- Safe because frozen incidents use soft-delete, never hard-delete, so FK is never violated.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_addenda_incident'
  ) THEN
    ALTER TABLE incident_addenda
      ADD CONSTRAINT fk_addenda_incident
        FOREIGN KEY (home_id, incident_id) REFERENCES incidents(home_id, id);
  END IF;
END;
$$;

-- DOWN
ALTER TABLE incident_addenda DROP CONSTRAINT IF EXISTS fk_addenda_incident;
