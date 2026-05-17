-- 030_create_pensions.sql
-- Pension auto-enrolment: config, enrolments, contributions.
-- Seeded with current qualifying earnings band.

-- UP

-- Effective-dated pension configuration.
-- One row per tax year; effective_from = April 6 of that year.
CREATE TABLE IF NOT EXISTS pension_config (
  id                      SERIAL PRIMARY KEY,
  effective_from          DATE NOT NULL UNIQUE,
  lower_qualifying_weekly NUMERIC(8,2) NOT NULL,   -- lower earnings limit (LEL) weekly
  upper_qualifying_weekly NUMERIC(8,2) NOT NULL,   -- upper earnings limit (UEL) weekly
  trigger_annual          NUMERIC(10,2) NOT NULL,  -- auto-enrolment earnings trigger
  employee_rate           NUMERIC(6,4) NOT NULL,   -- e.g. 0.05 (5%)
  employer_rate           NUMERIC(6,4) NOT NULL,   -- e.g. 0.03 (3%)
  state_pension_age       INTEGER NOT NULL DEFAULT 67
);

-- 2025/26 onwards: trigger GBP10,000; QE band GBP6,240-GBP50,270;
-- minimum contributions 5%+3%. The weekly lower qualifying limit is GBP120.
INSERT INTO pension_config
  (effective_from, lower_qualifying_weekly, upper_qualifying_weekly, trigger_annual, employee_rate, employer_rate, state_pension_age)
VALUES
  ('2025-04-06', 120.00, 967.00, 10000.00, 0.05, 0.03, 67),
  ('2026-04-06', 120.00, 967.00, 10000.00, 0.05, 0.03, 67)
ON CONFLICT (effective_from) DO NOTHING;

-- Per-staff enrolment record.
-- status: pending_assessment | eligible_enrolled | opted_out | postponed | opt_in_enrolled | entitled_not_enrolled
CREATE TABLE IF NOT EXISTS pension_enrolments (
  id                  SERIAL PRIMARY KEY,
  home_id             INTEGER NOT NULL REFERENCES homes(id),
  staff_id            VARCHAR(20) NOT NULL,
  status              VARCHAR(30) NOT NULL DEFAULT 'pending_assessment',
  enrolled_date       DATE,
  opted_out_date      DATE,
  postponed_until     DATE,
  reassessment_date   DATE,   -- next mandatory re-enrolment check (3-year cycle)
  notes               TEXT,
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(home_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_pension_enrolments_home ON pension_enrolments(home_id);

-- Pension contributions per payroll line.
-- Deleted and recreated on recalculate (payroll_line_id is the link).
CREATE TABLE IF NOT EXISTS pension_contributions (
  id                SERIAL PRIMARY KEY,
  home_id           INTEGER NOT NULL REFERENCES homes(id),
  payroll_line_id   INTEGER NOT NULL REFERENCES payroll_lines(id) ON DELETE CASCADE,
  staff_id          VARCHAR(20) NOT NULL,
  qualifying_pay    NUMERIC(10,2) NOT NULL,
  employee_amount   NUMERIC(10,2) NOT NULL,
  employer_amount   NUMERIC(10,2) NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pension_contributions_line ON pension_contributions(payroll_line_id);
CREATE INDEX IF NOT EXISTS idx_pension_contributions_home ON pension_contributions(home_id);

-- Home-level pension and employment allowance settings.
ALTER TABLE homes ADD COLUMN IF NOT EXISTS employment_allowance_claimed BOOLEAN DEFAULT false;
ALTER TABLE homes ADD COLUMN IF NOT EXISTS pension_provider_name VARCHAR(200);
ALTER TABLE homes ADD COLUMN IF NOT EXISTS pension_mode VARCHAR(20) NOT NULL DEFAULT 'npa'
  CHECK (pension_mode IN ('npa', 'ras', 'sacrifice'));

-- DOWN
ALTER TABLE homes DROP COLUMN IF EXISTS pension_provider_name;
ALTER TABLE homes DROP COLUMN IF EXISTS employment_allowance_claimed;
ALTER TABLE homes DROP COLUMN IF EXISTS pension_mode;
DROP TABLE IF EXISTS pension_contributions;
DROP TABLE IF EXISTS pension_enrolments;
DROP TABLE IF EXISTS pension_config;
