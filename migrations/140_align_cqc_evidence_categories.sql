DO $$
DECLARE
  existing_name text;
BEGIN
  SELECT con.conname
    INTO existing_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'cqc_evidence'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%evidence_category%';

  IF existing_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.cqc_evidence DROP CONSTRAINT %I', existing_name);
  END IF;
END $$;

ALTER TABLE cqc_evidence
  ADD CONSTRAINT cqc_evidence_category_check
  CHECK (
    evidence_category IS NULL OR evidence_category IN (
      'peoples_experience',
      'staff_leader_feedback',
      'partner_feedback',
      'observation',
      'processes',
      'outcomes',
      'feedback',
      'management_info'
    )
  );
