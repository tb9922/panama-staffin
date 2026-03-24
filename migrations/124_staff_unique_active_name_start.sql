-- Prevent duplicate active staff records (same home + name + start_date).
-- Partial index: WHERE deleted_at IS NULL so soft-deleted records don't block
-- re-hiring a staff member with the same name and start date.
-- NULL start_date values are treated as distinct by PostgreSQL and won't conflict.

CREATE UNIQUE INDEX IF NOT EXISTS staff_unique_active_name_start
  ON staff(home_id, name, start_date)
  WHERE deleted_at IS NULL;
