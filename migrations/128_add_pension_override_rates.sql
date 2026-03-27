-- 128_add_pension_override_rates.sql
-- Persist per-staff pension contribution overrides on pension enrolments.

-- UP
ALTER TABLE pension_enrolments
  ADD COLUMN IF NOT EXISTS contribution_override_employee NUMERIC(6,4),
  ADD COLUMN IF NOT EXISTS contribution_override_employer NUMERIC(6,4);

-- DOWN
ALTER TABLE pension_enrolments
  DROP COLUMN IF EXISTS contribution_override_employer,
  DROP COLUMN IF EXISTS contribution_override_employee;
