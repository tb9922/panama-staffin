-- Fourth-pass payroll/schema hardening.
-- - Correct pension qualifying earnings seed data and make employment allowance boolean two-state.
-- - Add home pension mode so non-NPA pension schemes cannot stay implicit.
-- - Add guarded DB constraints for payroll/staff/compliance enum-shaped fields.
-- - Add a GIN index for staff-involved incident SAR lookups.
-- - Persist webhook request IDs so retries keep the same dedupe key for receivers.

-- Pension QE lower limit is GBP120/wk (GBP6,240/year). Keep 2025/26 fixed and
-- seed 2026/27 explicitly so date-effective lookup does not silently reuse stale
-- rows forever.
UPDATE pension_config
   SET lower_qualifying_weekly = 120.00,
       upper_qualifying_weekly = 967.00,
       trigger_annual = 10000.00,
       employee_rate = 0.05,
       employer_rate = 0.03,
       state_pension_age = 67
 WHERE effective_from = DATE '2025-04-06';

INSERT INTO pension_config
  (effective_from, lower_qualifying_weekly, upper_qualifying_weekly, trigger_annual, employee_rate, employer_rate, state_pension_age)
VALUES
  (DATE '2026-04-06', 120.00, 967.00, 10000.00, 0.05, 0.03, 67)
ON CONFLICT (effective_from) DO UPDATE SET
  lower_qualifying_weekly = EXCLUDED.lower_qualifying_weekly,
  upper_qualifying_weekly = EXCLUDED.upper_qualifying_weekly,
  trigger_annual = EXCLUDED.trigger_annual,
  employee_rate = EXCLUDED.employee_rate,
  employer_rate = EXCLUDED.employer_rate,
  state_pension_age = EXCLUDED.state_pension_age;

ALTER TABLE homes ADD COLUMN IF NOT EXISTS pension_mode VARCHAR(20) DEFAULT 'npa';

UPDATE homes SET employment_allowance_claimed = false WHERE employment_allowance_claimed IS NULL;
ALTER TABLE homes ALTER COLUMN employment_allowance_claimed SET DEFAULT false;
ALTER TABLE homes ALTER COLUMN employment_allowance_claimed SET NOT NULL;

UPDATE homes SET pension_mode = 'npa' WHERE pension_mode IS NULL;
ALTER TABLE homes ALTER COLUMN pension_mode SET DEFAULT 'npa';
ALTER TABLE homes ALTER COLUMN pension_mode SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homes_pension_mode_check') THEN
    ALTER TABLE homes
      ADD CONSTRAINT homes_pension_mode_check
      CHECK (pension_mode IN ('npa', 'ras', 'sacrifice')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_hourly_rate_reasonable_check') THEN
    ALTER TABLE staff
      ADD CONSTRAINT staff_hourly_rate_reasonable_check
      CHECK (hourly_rate >= 0 AND hourly_rate <= 200) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incidents_severity_check') THEN
    ALTER TABLE incidents
      ADD CONSTRAINT incidents_severity_check
      CHECK (severity IS NULL OR severity IN ('minor', 'moderate', 'serious', 'major', 'catastrophic')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'complaints_status_check') THEN
    ALTER TABLE complaints
      ADD CONSTRAINT complaints_status_check
      CHECK (status IS NULL OR status IN ('open', 'acknowledged', 'investigating', 'resolved', 'closed')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_register_status_check') THEN
    ALTER TABLE risk_register
      ADD CONSTRAINT risk_register_status_check
      CHECK (status IS NULL OR status IN ('open', 'mitigated', 'accepted', 'closed')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dols_application_type_check') THEN
    ALTER TABLE dols
      ADD CONSTRAINT dols_application_type_check
      CHECK (application_type IS NULL OR application_type IN ('dols', 'lps')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whistleblowing_status_check') THEN
    ALTER TABLE whistleblowing_concerns
      ADD CONSTRAINT whistleblowing_status_check
      CHECK (status IS NULL OR status IN ('registered', 'investigating', 'resolved', 'closed')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'policy_reviews_status_check') THEN
    ALTER TABLE policy_reviews
      ADD CONSTRAINT policy_reviews_status_check
      CHECK (status IS NULL OR status IN ('current', 'under_review', 'due', 'overdue', 'not_reviewed')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timesheet_entries_status_check') THEN
    ALTER TABLE timesheet_entries
      ADD CONSTRAINT timesheet_entries_status_check
      CHECK (status IN ('pending', 'approved', 'disputed', 'locked')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_incidents_staff_involved_gin
  ON incidents USING GIN (staff_involved jsonb_path_ops);

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS request_id TEXT;

UPDATE webhook_deliveries
   SET request_id = 'whd-' || id::text
 WHERE request_id IS NULL;

ALTER TABLE webhook_deliveries
  ALTER COLUMN request_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_request_id
  ON webhook_deliveries(request_id);

-- DOWN
DROP INDEX IF EXISTS idx_webhook_deliveries_request_id;
ALTER TABLE webhook_deliveries DROP COLUMN IF EXISTS request_id;
DROP INDEX IF EXISTS idx_incidents_staff_involved_gin;

ALTER TABLE timesheet_entries DROP CONSTRAINT IF EXISTS timesheet_entries_status_check;
ALTER TABLE policy_reviews DROP CONSTRAINT IF EXISTS policy_reviews_status_check;
ALTER TABLE whistleblowing_concerns DROP CONSTRAINT IF EXISTS whistleblowing_status_check;
ALTER TABLE dols DROP CONSTRAINT IF EXISTS dols_application_type_check;
ALTER TABLE risk_register DROP CONSTRAINT IF EXISTS risk_register_status_check;
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_status_check;
ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_severity_check;
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_hourly_rate_reasonable_check;
ALTER TABLE homes DROP CONSTRAINT IF EXISTS homes_pension_mode_check;
ALTER TABLE homes DROP COLUMN IF EXISTS pension_mode;
