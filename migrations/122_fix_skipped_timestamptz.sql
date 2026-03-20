-- Migration 109 skipped 3 tables with incorrect comments:
--   "renamed to pay_rate_rules" / "is timesheet_entries" / "is hmrc_liabilities"
-- Those ARE the actual table names — the commented-out ALTERs used the old names
-- (pay_rates, timesheets, hmrc_submissions) which no longer exist.
-- This migration corrects the oversight.

ALTER TABLE pay_rate_rules
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE timesheet_entries
  ALTER COLUMN approved_at TYPE TIMESTAMPTZ USING approved_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE hmrc_liabilities
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
