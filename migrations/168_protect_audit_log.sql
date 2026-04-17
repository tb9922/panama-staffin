-- UP
CREATE OR REPLACE FUNCTION protect_audit_log_mutations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF COALESCE(current_setting('app.audit_log_allow_update', true), 'off') <> 'on' THEN
      RAISE EXCEPTION 'audit_log is append-only; updates require elevated session flag'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(current_setting('app.audit_log_allow_delete', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'audit_log is append-only; deletes require elevated session flag'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_audit_log ON audit_log;
CREATE TRIGGER trg_protect_audit_log
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION protect_audit_log_mutations();

-- DOWN
DROP TRIGGER IF EXISTS trg_protect_audit_log ON audit_log;
DROP FUNCTION IF EXISTS protect_audit_log_mutations();
