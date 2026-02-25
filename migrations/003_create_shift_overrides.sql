-- UP
-- shift_overrides: the HOT PATH. Every rotation.getActualShift() call hits this table.
-- 40 staff × 28 days = 1,120 lookups per full cycle load.
-- Identity is (home_id, date, staff_id) — no surrogate key needed.
-- staff_id may be a virtual agency staff ID not present in the staff table.
-- No soft delete: this is schedule data, not regulated. Save replaces all overrides
-- for a home within a transaction (DELETE + INSERT).

CREATE TABLE IF NOT EXISTS shift_overrides (
  home_id     INTEGER      NOT NULL REFERENCES homes(id),
  date        DATE         NOT NULL,
  staff_id    VARCHAR(20)  NOT NULL,
  shift       VARCHAR(20)  NOT NULL,
  reason      TEXT,
  source      VARCHAR(30),
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (home_id, date, staff_id)
);

-- Single-day lookup (getActualShift / getStaffForDay)
CREATE INDEX IF NOT EXISTS idx_overrides_home_date
  ON shift_overrides(home_id, date);

-- Date-range scan for accrual (countALInLeaveYear) and AL entitlement validation
CREATE INDEX IF NOT EXISTS idx_overrides_home_staff_date
  ON shift_overrides(home_id, staff_id, date);

-- DOWN
DROP TABLE IF EXISTS shift_overrides;
