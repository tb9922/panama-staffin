-- 029_create_tax_records.sql
-- Tax codes per staff, tax/NI/student-loan rate tables, YTD accumulators,
-- and new deduction columns on payroll_lines.

-- UP

-- Current tax code record per staff member.
-- UNIQUE on (home_id, staff_id, effective_from) — multiple rows allowed when code changes;
-- getTaxCodeForStaff selects the most recent row with effective_from <= asOfDate.
CREATE TABLE IF NOT EXISTS tax_codes (
  id                SERIAL PRIMARY KEY,
  home_id           INTEGER NOT NULL REFERENCES homes(id),
  staff_id          VARCHAR(20) NOT NULL,
  tax_code          VARCHAR(20) NOT NULL DEFAULT '1257L',
  basis             VARCHAR(10) NOT NULL DEFAULT 'cumulative',  -- 'cumulative' | 'w1m1'
  ni_category       CHAR(1) NOT NULL DEFAULT 'A',
  effective_from    DATE NOT NULL DEFAULT CURRENT_DATE,
  previous_pay      NUMERIC(10,2) DEFAULT 0,  -- P45 prior pay in tax year
  previous_tax      NUMERIC(10,2) DEFAULT 0,  -- P45 prior tax in tax year
  student_loan_plan VARCHAR(20),              -- '1' | '2' | 'PG' | '1,PG' etc
  source            VARCHAR(30) NOT NULL DEFAULT 'manual',  -- 'manual' | 'p45' | 'hmrc_notice'
  notes             TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(home_id, staff_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_tax_codes_home_staff ON tax_codes(home_id, staff_id);

-- Income tax bands.
-- country: 'england_wales' | 'scotland'
-- band_name: 'starter' | 'basic' | 'intermediate' | 'higher' | 'advanced' | 'top' | 'additional'
-- Seeded for 2025/26 (tax_year = 2025).
CREATE TABLE IF NOT EXISTS tax_bands (
  id          SERIAL PRIMARY KEY,
  country     VARCHAR(20) NOT NULL,
  tax_year    INTEGER NOT NULL,
  band_name   VARCHAR(20) NOT NULL,
  lower_limit NUMERIC(10,2) NOT NULL,   -- annual, inclusive
  upper_limit NUMERIC(10,2),            -- NULL = no upper cap
  rate        NUMERIC(6,4) NOT NULL,    -- e.g. 0.20 for 20%
  UNIQUE(country, tax_year, band_name)
);

-- England & Wales 2025/26
INSERT INTO tax_bands (country, tax_year, band_name, lower_limit, upper_limit, rate) VALUES
  ('england_wales', 2025, 'basic',      0,         37700, 0.20),
  ('england_wales', 2025, 'higher',     37700,    125140, 0.40),
  ('england_wales', 2025, 'additional', 125140,     NULL, 0.45)
ON CONFLICT (country, tax_year, band_name) DO NOTHING;

-- Scotland 2025/26
INSERT INTO tax_bands (country, tax_year, band_name, lower_limit, upper_limit, rate) VALUES
  ('scotland', 2025, 'starter',      0,       2306, 0.19),
  ('scotland', 2025, 'basic',     2306,      13991, 0.20),
  ('scotland', 2025, 'intermediate', 13991,  31092, 0.21),
  ('scotland', 2025, 'higher',    31092,     62430, 0.42),
  ('scotland', 2025, 'advanced',  62430,    125140, 0.45),
  ('scotland', 2025, 'top',      125140,      NULL, 0.48)
ON CONFLICT (country, tax_year, band_name) DO NOTHING;

-- National Insurance thresholds (annual and weekly equivalents).
-- threshold_name: 'LEL' | 'ST' | 'PT' | 'UEL'
CREATE TABLE IF NOT EXISTS ni_thresholds (
  id              SERIAL PRIMARY KEY,
  tax_year        INTEGER NOT NULL,
  threshold_name  VARCHAR(10) NOT NULL,
  weekly_amount   NUMERIC(8,2) NOT NULL,
  monthly_amount  NUMERIC(8,2) NOT NULL,
  annual_amount   NUMERIC(10,2) NOT NULL,
  UNIQUE(tax_year, threshold_name)
);

-- 2025/26 thresholds
INSERT INTO ni_thresholds (tax_year, threshold_name, weekly_amount, monthly_amount, annual_amount) VALUES
  (2025, 'LEL',  125.00,    542.00,   6500.00),
  (2025, 'ST',   175.00,    758.00,   9100.00),
  (2025, 'PT',   242.00,   1048.00,  12570.00),
  (2025, 'UEL',  967.00,   4189.00,  50270.00)
ON CONFLICT (tax_year, threshold_name) DO NOTHING;

-- National Insurance rates per category.
-- rate_type: 'employee_main' | 'employee_above_uel' | 'employer'
-- Category A seeded only for Phase 2. Categories B/C/J seeded in Phase 3.
CREATE TABLE IF NOT EXISTS ni_rates (
  id          SERIAL PRIMARY KEY,
  tax_year    INTEGER NOT NULL,
  ni_category CHAR(1) NOT NULL,
  rate_type   VARCHAR(25) NOT NULL,
  rate        NUMERIC(6,4) NOT NULL,
  UNIQUE(tax_year, ni_category, rate_type)
);

-- 2025/26 Category A rates
-- Employee: 8% between PT and UEL, 2% above UEL (from April 2024)
-- Employer: 15% above ST (from April 2025, no upper limit)
INSERT INTO ni_rates (tax_year, ni_category, rate_type, rate) VALUES
  (2025, 'A', 'employee_main',      0.08),
  (2025, 'A', 'employee_above_uel', 0.02),
  (2025, 'A', 'employer',           0.15)
ON CONFLICT (tax_year, ni_category, rate_type) DO NOTHING;

-- Student loan repayment thresholds.
-- plan: '1' | '2' | '4' (Scotland) | 'PG'
CREATE TABLE IF NOT EXISTS student_loan_thresholds (
  id              SERIAL PRIMARY KEY,
  tax_year        INTEGER NOT NULL,
  plan            VARCHAR(5) NOT NULL,
  annual_threshold NUMERIC(10,2) NOT NULL,
  rate            NUMERIC(6,4) NOT NULL,   -- 9% for plans 1/2, 6% for PG
  UNIQUE(tax_year, plan)
);

-- 2025/26 thresholds
INSERT INTO student_loan_thresholds (tax_year, plan, annual_threshold, rate) VALUES
  (2025, '1',  24990, 0.09),
  (2025, '2',  28470, 0.09),
  (2025, 'PG', 21000, 0.06)
ON CONFLICT (tax_year, plan) DO NOTHING;

-- Year-to-date accumulators.
-- Written ONLY when a payroll run is approved — never on calculate.
-- UNIQUE on (home_id, staff_id, tax_year): one row per staff per year, incremented each run.
CREATE TABLE IF NOT EXISTS payroll_ytd (
  id                SERIAL PRIMARY KEY,
  home_id           INTEGER NOT NULL REFERENCES homes(id),
  staff_id          VARCHAR(20) NOT NULL,
  tax_year          INTEGER NOT NULL,        -- e.g. 2025 for 2025-26
  gross_pay         NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable_pay       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_deducted      NUMERIC(12,2) NOT NULL DEFAULT 0,
  employee_ni       NUMERIC(12,2) NOT NULL DEFAULT 0,
  employer_ni       NUMERIC(12,2) NOT NULL DEFAULT 0,
  student_loan      NUMERIC(12,2) NOT NULL DEFAULT 0,
  pension_employee  NUMERIC(12,2) NOT NULL DEFAULT 0,
  pension_employer  NUMERIC(12,2) NOT NULL DEFAULT 0,
  holiday_pay       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ssp_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay           NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(home_id, staff_id, tax_year)
);

CREATE INDEX IF NOT EXISTS idx_payroll_ytd_home_staff ON payroll_ytd(home_id, staff_id);

-- New deduction columns on payroll_lines (all nullable — safe for existing Phase 1 runs).
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS holiday_days          NUMERIC(4,1) DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS holiday_pay           NUMERIC(10,2) DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS holiday_daily_rate    NUMERIC(8,2);
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS ssp_days              INTEGER DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS ssp_amount            NUMERIC(10,2) DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS enhanced_sick_amount  NUMERIC(10,2) DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS pension_employee      NUMERIC(10,2) DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS pension_employer      NUMERIC(10,2) DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS tax_deducted          NUMERIC(10,2) DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS employee_ni           NUMERIC(10,2) DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS employer_ni           NUMERIC(10,2) DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS student_loan          NUMERIC(10,2) DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS other_deductions      NUMERIC(10,2) DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS net_pay               NUMERIC(10,2) DEFAULT 0;

-- Widen student_loan_plan to support comma-separated dual plans (e.g. '1,PG').
ALTER TABLE payroll_lines ALTER COLUMN student_loan_plan TYPE VARCHAR(20);

-- NI number on staff (UK format: XX 99 99 99 X).
ALTER TABLE staff ADD COLUMN IF NOT EXISTS ni_number VARCHAR(20);

-- Index for 52-week holiday pay lookback query — critical for scale.
CREATE INDEX IF NOT EXISTS idx_payroll_shifts_line_date
  ON payroll_line_shifts(payroll_line_id, date);

-- DOWN
DROP INDEX IF EXISTS idx_payroll_shifts_line_date;
ALTER TABLE staff DROP COLUMN IF EXISTS ni_number;
ALTER TABLE payroll_lines DROP COLUMN IF EXISTS net_pay;
ALTER TABLE payroll_lines DROP COLUMN IF EXISTS other_deductions;
ALTER TABLE payroll_lines DROP COLUMN IF EXISTS student_loan;
ALTER TABLE payroll_lines DROP COLUMN IF EXISTS employer_ni;
ALTER TABLE payroll_lines DROP COLUMN IF EXISTS employee_ni;
ALTER TABLE payroll_lines DROP COLUMN IF EXISTS tax_deducted;
ALTER TABLE payroll_lines DROP COLUMN IF EXISTS pension_employer;
ALTER TABLE payroll_lines DROP COLUMN IF EXISTS pension_employee;
ALTER TABLE payroll_lines DROP COLUMN IF EXISTS enhanced_sick_amount;
ALTER TABLE payroll_lines DROP COLUMN IF EXISTS ssp_amount;
ALTER TABLE payroll_lines DROP COLUMN IF EXISTS ssp_days;
ALTER TABLE payroll_lines DROP COLUMN IF EXISTS holiday_daily_rate;
ALTER TABLE payroll_lines DROP COLUMN IF EXISTS holiday_pay;
ALTER TABLE payroll_lines DROP COLUMN IF EXISTS holiday_days;
DROP TABLE IF EXISTS payroll_ytd;
DROP TABLE IF EXISTS student_loan_thresholds;
DROP TABLE IF EXISTS ni_rates;
DROP TABLE IF EXISTS ni_thresholds;
DROP TABLE IF EXISTS tax_bands;
DROP TABLE IF EXISTS tax_codes;
