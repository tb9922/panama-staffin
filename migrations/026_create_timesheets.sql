-- UP
-- timesheet_entries: actual attendance vs scheduled shift, with snap-to-shift applied.
-- One row per staff per date. Phase 1: manager-entered actual times (no clock-in hardware).
-- Snap logic: if actual_start within snap_window_minutes before scheduled_start,
--             snap to scheduled_start. Saves care homes ~£40K/year in early-clock-in creep.
-- payable_hours: snapped hours minus break, used by payroll calculation engine.
-- Status machine: pending → approved/disputed → (payroll approve) → locked
-- locked entries cannot be edited without admin override.

CREATE TABLE IF NOT EXISTS timesheet_entries (
  id                  SERIAL PRIMARY KEY,
  home_id             INTEGER NOT NULL REFERENCES homes(id),
  staff_id            VARCHAR(20) NOT NULL,
  date                DATE NOT NULL,
  scheduled_start     TIME,
  scheduled_end       TIME,
  actual_start        TIME,
  actual_end          TIME,
  snapped_start       TIME,
  snapped_end         TIME,
  snap_applied        BOOLEAN NOT NULL DEFAULT false,
  snap_minutes_saved  NUMERIC(5,1) NOT NULL DEFAULT 0,
  break_minutes       INTEGER NOT NULL DEFAULT 0,
  payable_hours       NUMERIC(5,2),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending' | 'approved' | 'disputed' | 'locked'
  approved_by         VARCHAR(100),
  approved_at         TIMESTAMP,
  dispute_reason      TEXT,
  notes               TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(home_id, staff_id, date)
);

-- Primary lookup: daily attendance view (all staff for a date)
CREATE INDEX IF NOT EXISTS idx_ts_home_date   ON timesheet_entries(home_id, date);
-- Secondary: payroll period query + status filtering
CREATE INDEX IF NOT EXISTS idx_ts_home_period ON timesheet_entries(home_id, date, status);

-- DOWN
DROP TABLE IF EXISTS timesheet_entries;
