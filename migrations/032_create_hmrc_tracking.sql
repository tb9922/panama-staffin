-- 032_create_hmrc_tracking.sql
-- HMRC monthly liability tracker.
-- One row per home per tax month (1=April, 12=March).
-- Updated/upserted when a payroll run is approved.

-- UP

CREATE TABLE IF NOT EXISTS hmrc_liabilities (
  id                        SERIAL PRIMARY KEY,
  home_id                   INTEGER NOT NULL REFERENCES homes(id),
  tax_year                  INTEGER NOT NULL,   -- e.g. 2025 for 2025-26
  tax_month                 INTEGER NOT NULL,   -- 1-12 (1 = 6 Apr to 5 May)
  period_start              DATE NOT NULL,
  period_end                DATE NOT NULL,
  total_paye                NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_employee_ni         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_employer_ni         NUMERIC(12,2) NOT NULL DEFAULT 0,
  employment_allowance_offset NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_due                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_due_date          DATE NOT NULL,      -- 19th of following month
  status                    VARCHAR(10) NOT NULL DEFAULT 'unpaid',  -- 'unpaid' | 'paid' | 'overdue'
  paid_date                 DATE,
  paid_reference            VARCHAR(100),
  created_at                TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(home_id, tax_year, tax_month)
);

CREATE INDEX IF NOT EXISTS idx_hmrc_liabilities_home ON hmrc_liabilities(home_id, tax_year);

-- DOWN
DROP TABLE IF EXISTS hmrc_liabilities;
