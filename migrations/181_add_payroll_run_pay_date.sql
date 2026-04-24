-- UP
ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS pay_date DATE;

UPDATE payroll_runs
SET pay_date = period_end
WHERE pay_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_runs_home_pay_date
  ON payroll_runs(home_id, pay_date);

-- DOWN
DROP INDEX IF EXISTS idx_payroll_runs_home_pay_date;

ALTER TABLE payroll_runs
  DROP COLUMN IF EXISTS pay_date;
