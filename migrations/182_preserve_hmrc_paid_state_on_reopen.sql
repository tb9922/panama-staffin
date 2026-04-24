-- UP
ALTER TABLE hmrc_liabilities
  ADD COLUMN IF NOT EXISTS reopened_paid_date DATE,
  ADD COLUMN IF NOT EXISTS reopened_paid_reference VARCHAR(100),
  ADD COLUMN IF NOT EXISTS reopened_paid_total_due NUMERIC(12,2);

-- DOWN
ALTER TABLE hmrc_liabilities
  DROP COLUMN IF EXISTS reopened_paid_total_due,
  DROP COLUMN IF EXISTS reopened_paid_reference,
  DROP COLUMN IF EXISTS reopened_paid_date;
