-- UP
CREATE TABLE IF NOT EXISTS shift_hour_adjustments (
  id         SERIAL PRIMARY KEY,
  home_id    INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  staff_id   VARCHAR(20) NOT NULL,
  date       DATE NOT NULL,
  kind       VARCHAR(32) NOT NULL CHECK (kind IN ('annual_leave', 'paid_authorised_absence')),
  hours      NUMERIC(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  note       TEXT,
  source     VARCHAR(20) NOT NULL DEFAULT 'manual',
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (home_id, staff_id, date),
  FOREIGN KEY (home_id, staff_id) REFERENCES staff(home_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shift_hour_adjustments_home_date
  ON shift_hour_adjustments(home_id, date);

CREATE INDEX IF NOT EXISTS idx_shift_hour_adjustments_home_staff_date
  ON shift_hour_adjustments(home_id, staff_id, date);

ALTER TABLE payroll_lines
  ADD COLUMN IF NOT EXISTS authorised_absence_hours NUMERIC(6,2) NOT NULL DEFAULT 0;

ALTER TABLE payroll_lines
  ADD COLUMN IF NOT EXISTS authorised_absence_pay NUMERIC(10,2) NOT NULL DEFAULT 0;

-- DOWN
ALTER TABLE payroll_lines
  DROP COLUMN IF EXISTS authorised_absence_pay;

ALTER TABLE payroll_lines
  DROP COLUMN IF EXISTS authorised_absence_hours;

DROP TABLE IF EXISTS shift_hour_adjustments;
