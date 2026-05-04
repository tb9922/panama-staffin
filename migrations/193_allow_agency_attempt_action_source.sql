-- UP
-- Agency emergency overrides can now open an idempotent manager action.

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname
    INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
   WHERE rel.relname = 'action_items'
     AND nsp.nspname = 'public'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) LIKE '%source_type%'
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE action_items DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE action_items
  ADD CONSTRAINT action_items_source_type_check
  CHECK (
    source_type IN (
      'standalone', 'incident', 'ipc_audit', 'risk', 'complaint',
      'complaint_survey', 'maintenance', 'fire_drill', 'supervision',
      'appraisal', 'hr_grievance', 'agency_approval_attempt',
      'cqc_observation', 'cqc_narrative', 'reflective_practice'
    )
  );

-- DOWN
ALTER TABLE action_items DROP CONSTRAINT IF EXISTS action_items_source_type_check;

ALTER TABLE action_items
  ADD CONSTRAINT action_items_source_type_check
  CHECK (
    source_type IN (
      'standalone', 'incident', 'ipc_audit', 'risk', 'complaint',
      'complaint_survey', 'maintenance', 'fire_drill', 'supervision',
      'appraisal', 'hr_grievance', 'cqc_observation', 'cqc_narrative',
      'reflective_practice'
    )
  );
