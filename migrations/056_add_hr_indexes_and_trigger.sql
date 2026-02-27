-- UP
-- 1. Composite index on hr_case_notes for home_id + case_type + case_id lookups
CREATE INDEX IF NOT EXISTS idx_hr_case_notes_home_case
  ON hr_case_notes(home_id, case_type, case_id);

-- 2. Index on hr_family_leave.protected_period_end for deadline queries
CREATE INDEX IF NOT EXISTS idx_hr_family_leave_protected_end
  ON hr_family_leave(protected_period_end) WHERE protected_period_end IS NOT NULL;

-- 3. Reusable updated_at trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all HR tables that have an updated_at column.
-- hr_grievance_actions and hr_case_notes are excluded (no updated_at column).

DROP TRIGGER IF EXISTS trg_updated_at_hr_disciplinary_cases ON hr_disciplinary_cases;
CREATE TRIGGER trg_updated_at_hr_disciplinary_cases
  BEFORE UPDATE ON hr_disciplinary_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_updated_at_hr_grievance_cases ON hr_grievance_cases;
CREATE TRIGGER trg_updated_at_hr_grievance_cases
  BEFORE UPDATE ON hr_grievance_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_updated_at_hr_performance_cases ON hr_performance_cases;
CREATE TRIGGER trg_updated_at_hr_performance_cases
  BEFORE UPDATE ON hr_performance_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_updated_at_hr_rtw_interviews ON hr_rtw_interviews;
CREATE TRIGGER trg_updated_at_hr_rtw_interviews
  BEFORE UPDATE ON hr_rtw_interviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_updated_at_hr_oh_referrals ON hr_oh_referrals;
CREATE TRIGGER trg_updated_at_hr_oh_referrals
  BEFORE UPDATE ON hr_oh_referrals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_updated_at_hr_contracts ON hr_contracts;
CREATE TRIGGER trg_updated_at_hr_contracts
  BEFORE UPDATE ON hr_contracts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_updated_at_hr_family_leave ON hr_family_leave;
CREATE TRIGGER trg_updated_at_hr_family_leave
  BEFORE UPDATE ON hr_family_leave
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_updated_at_hr_flexible_working ON hr_flexible_working;
CREATE TRIGGER trg_updated_at_hr_flexible_working
  BEFORE UPDATE ON hr_flexible_working
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_updated_at_hr_edi_records ON hr_edi_records;
CREATE TRIGGER trg_updated_at_hr_edi_records
  BEFORE UPDATE ON hr_edi_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_updated_at_hr_tupe_transfers ON hr_tupe_transfers;
CREATE TRIGGER trg_updated_at_hr_tupe_transfers
  BEFORE UPDATE ON hr_tupe_transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_updated_at_hr_rtw_dbs_renewals ON hr_rtw_dbs_renewals;
CREATE TRIGGER trg_updated_at_hr_rtw_dbs_renewals
  BEFORE UPDATE ON hr_rtw_dbs_renewals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS trg_updated_at_hr_disciplinary_cases ON hr_disciplinary_cases;
DROP TRIGGER IF EXISTS trg_updated_at_hr_grievance_cases ON hr_grievance_cases;
DROP TRIGGER IF EXISTS trg_updated_at_hr_performance_cases ON hr_performance_cases;
DROP TRIGGER IF EXISTS trg_updated_at_hr_rtw_interviews ON hr_rtw_interviews;
DROP TRIGGER IF EXISTS trg_updated_at_hr_oh_referrals ON hr_oh_referrals;
DROP TRIGGER IF EXISTS trg_updated_at_hr_contracts ON hr_contracts;
DROP TRIGGER IF EXISTS trg_updated_at_hr_family_leave ON hr_family_leave;
DROP TRIGGER IF EXISTS trg_updated_at_hr_flexible_working ON hr_flexible_working;
DROP TRIGGER IF EXISTS trg_updated_at_hr_edi_records ON hr_edi_records;
DROP TRIGGER IF EXISTS trg_updated_at_hr_tupe_transfers ON hr_tupe_transfers;
DROP TRIGGER IF EXISTS trg_updated_at_hr_rtw_dbs_renewals ON hr_rtw_dbs_renewals;
DROP FUNCTION IF EXISTS set_updated_at();
DROP INDEX IF EXISTS idx_hr_family_leave_protected_end;
DROP INDEX IF EXISTS idx_hr_case_notes_home_case;
