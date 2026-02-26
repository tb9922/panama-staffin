-- UP
-- payroll_runs: a single payroll calculation for a home covering a pay period.
-- State machine: draft → calculated → approved → exported → locked (terminal).
-- payroll_lines: one row per active staff member per run. Accumulates shift totals.
-- payroll_line_shifts: granular per-shift detail for audit trail and payslip generation.
-- NMW compliance is tracked per line and per shift (effective_hourly_rate).
-- Approval is blocked if any payroll_line.nmw_compliant = false.

CREATE TABLE payroll_runs (
  id                  SERIAL PRIMARY KEY,
  home_id             INTEGER NOT NULL REFERENCES homes(id),
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  pay_frequency       VARCHAR(20) NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft' | 'calculated' | 'approved' | 'exported' | 'locked'
  total_gross         NUMERIC(10,2),
  total_enhancements  NUMERIC(10,2),
  total_sleep_ins     NUMERIC(10,2),
  staff_count         INTEGER,
  calculated_at       TIMESTAMP,
  approved_by         VARCHAR(100),
  approved_at         TIMESTAMP,
  exported_at         TIMESTAMP,
  export_format       VARCHAR(20),
  notes               TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(home_id, period_start, period_end)
);

CREATE TABLE payroll_lines (
  id                       SERIAL PRIMARY KEY,
  payroll_run_id           INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  staff_id                 VARCHAR(20) NOT NULL,
  base_hours               NUMERIC(6,2) NOT NULL DEFAULT 0,
  base_pay                 NUMERIC(10,2) NOT NULL DEFAULT 0,
  night_hours              NUMERIC(6,2) NOT NULL DEFAULT 0,
  night_enhancement        NUMERIC(10,2) NOT NULL DEFAULT 0,
  weekend_hours            NUMERIC(6,2) NOT NULL DEFAULT 0,
  weekend_enhancement      NUMERIC(10,2) NOT NULL DEFAULT 0,
  bank_holiday_hours       NUMERIC(6,2) NOT NULL DEFAULT 0,
  bank_holiday_enhancement NUMERIC(10,2) NOT NULL DEFAULT 0,
  overtime_hours           NUMERIC(6,2) NOT NULL DEFAULT 0,
  overtime_enhancement     NUMERIC(10,2) NOT NULL DEFAULT 0,
  sleep_in_count           INTEGER NOT NULL DEFAULT 0,
  sleep_in_pay             NUMERIC(10,2) NOT NULL DEFAULT 0,
  on_call_hours            NUMERIC(6,2) NOT NULL DEFAULT 0,
  on_call_enhancement      NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_hours              NUMERIC(6,2) NOT NULL DEFAULT 0,
  total_enhancements       NUMERIC(10,2) NOT NULL DEFAULT 0,
  gross_pay                NUMERIC(10,2) NOT NULL DEFAULT 0,
  nmw_compliant            BOOLEAN NOT NULL DEFAULT true,
  nmw_lowest_rate          NUMERIC(6,2),  -- lowest effective hourly rate across all shifts
  tax_code                 VARCHAR(20),   -- for Sage/Xero export
  student_loan_plan        VARCHAR(10),   -- '1'|'2'|'4'|'5'|'PG' — for export
  notes                    TEXT,
  UNIQUE(payroll_run_id, staff_id)
);

-- payroll_line_shifts: per-shift detail row. Immutable once created (recalculate = delete + recreate).
-- enhancements_json: [{type, applies_to, rate_type, amount, enhancementAmount}] for payslip breakdown.
CREATE TABLE payroll_line_shifts (
  id                    SERIAL PRIMARY KEY,
  payroll_line_id       INTEGER NOT NULL REFERENCES payroll_lines(id) ON DELETE CASCADE,
  date                  DATE NOT NULL,
  shift_code            VARCHAR(10) NOT NULL,
  hours                 NUMERIC(5,2) NOT NULL,
  base_rate             NUMERIC(8,2) NOT NULL,
  base_amount           NUMERIC(10,2) NOT NULL,
  enhancements_json     JSONB,
  total_amount          NUMERIC(10,2) NOT NULL,
  effective_hourly_rate NUMERIC(8,2) NOT NULL
);

CREATE INDEX idx_payroll_runs_home   ON payroll_runs(home_id);
CREATE INDEX idx_payroll_lines_run   ON payroll_lines(payroll_run_id);
CREATE INDEX idx_payroll_shifts_line ON payroll_line_shifts(payroll_line_id);

-- DOWN
DROP TABLE IF EXISTS payroll_line_shifts;
DROP TABLE IF EXISTS payroll_lines;
DROP TABLE IF EXISTS payroll_runs;
