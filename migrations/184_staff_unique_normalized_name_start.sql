-- Treat active staff names consistently for duplicate prevention.
-- Blank start dates now collide via a sentinel date, and names are trimmed,
-- case-folded, and whitespace-collapsed before uniqueness is checked.

DROP INDEX IF EXISTS staff_unique_active_name_start;

CREATE UNIQUE INDEX IF NOT EXISTS staff_unique_active_name_start
  ON staff(
    home_id,
    lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')),
    COALESCE(start_date, DATE '1900-01-01')
  )
  WHERE deleted_at IS NULL;
