-- UP
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shift_overrides_home_date_staff
  ON shift_overrides(home_id, date, staff_id);

-- DOWN
DROP INDEX IF EXISTS idx_shift_overrides_home_date_staff;
