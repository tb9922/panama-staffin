-- UP
-- Stop hard home deletes from cascading through regulated evidence tables.
-- Homes are already soft-deleted via homes.deleted_at; a physical delete should
-- fail unless an operator has deliberately cleaned dependent records first.
DO $$
DECLARE
  rec RECORD;
  update_action TEXT;
  match_clause TEXT;
  deferrable_clause TEXT;
BEGIN
  IF current_database() !~* '(^|[_-])(test|vitest|ci)($|[_-])' THEN
    FOR rec IN
      SELECT
        c.conname,
        c.conrelid::regclass AS table_name,
        c.confupdtype,
        c.confmatchtype,
        c.condeferrable,
        c.condeferred,
        string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord) AS local_columns,
        string_agg(quote_ident(fa.attname), ', ' ORDER BY u.ord) AS foreign_columns
      FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord) ON TRUE
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
      JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = c.confkey[u.ord]
      WHERE c.contype = 'f'
        AND c.confrelid = 'homes'::regclass
        AND c.confdeltype = 'c'
        AND c.conrelid::regclass::text <> 'user_home_roles'
      GROUP BY c.conname, c.conrelid, c.confupdtype, c.confmatchtype, c.condeferrable, c.condeferred
    LOOP
      update_action := CASE rec.confupdtype
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
        WHEN 'r' THEN 'RESTRICT'
        ELSE 'NO ACTION'
      END;

      match_clause := CASE rec.confmatchtype
        WHEN 'f' THEN ' MATCH FULL'
        WHEN 'p' THEN ' MATCH PARTIAL'
        ELSE ''
      END;

      deferrable_clause := CASE
        WHEN rec.condeferrable AND rec.condeferred THEN ' DEFERRABLE INITIALLY DEFERRED'
        WHEN rec.condeferrable THEN ' DEFERRABLE'
        ELSE ''
      END;

      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', rec.table_name, rec.conname);
      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES homes(%s)%s ON UPDATE %s ON DELETE RESTRICT%s',
        rec.table_name,
        rec.conname,
        rec.local_columns,
        rec.foreign_columns,
        match_clause,
        update_action,
        deferrable_clause
      );
    END LOOP;
  END IF;
END $$;

-- Keep access logs after a home is retired or manually cleaned. Migration 169
-- only rewrote NO ACTION constraints, but this restates the audit-safe intent.
ALTER TABLE access_log
  DROP CONSTRAINT IF EXISTS access_log_home_id_fkey,
  ADD CONSTRAINT access_log_home_id_fkey
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE SET NULL;

-- DB-level guard: service code should void payroll runs, not delete regulated
-- payroll evidence after approval/export/lock.
CREATE OR REPLACE FUNCTION prevent_locked_payroll_run_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.audit_log_allow_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF OLD.status IN ('approved', 'exported', 'locked') THEN
    RAISE EXCEPTION 'Cannot delete payroll run % with status %; void/reverse through payroll service', OLD.id, OLD.status
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_locked_payroll_run_delete ON payroll_runs;
CREATE TRIGGER trg_prevent_locked_payroll_run_delete
BEFORE DELETE ON payroll_runs
FOR EACH ROW EXECUTE FUNCTION prevent_locked_payroll_run_delete();

-- Add explicit optimistic-lock counters to regulated legacy surfaces that still
-- relied only on timestamps. Repositories increment these counters on mutation.
ALTER TABLE training_records ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE supervisions     ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE appraisals       ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE fire_drills      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE onboarding       ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE retention_purge_files
  DROP CONSTRAINT IF EXISTS retention_purge_files_status_check;

ALTER TABLE retention_purge_files
  ADD CONSTRAINT retention_purge_files_status_check
  CHECK (status IN ('pending', 'processing', 'deleted', 'failed'));

-- DOWN
DROP TRIGGER IF EXISTS trg_prevent_locked_payroll_run_delete ON payroll_runs;
DROP FUNCTION IF EXISTS prevent_locked_payroll_run_delete();
