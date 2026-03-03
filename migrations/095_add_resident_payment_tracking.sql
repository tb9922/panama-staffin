-- Add payment tracking columns to finance_residents
-- These are system-managed (not user-editable), updated atomically when invoice payments change

ALTER TABLE finance_residents
  ADD COLUMN IF NOT EXISTS last_payment_date   DATE,
  ADD COLUMN IF NOT EXISTS last_payment_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS outstanding_balance NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_fin_residents_outstanding
  ON finance_residents(home_id, outstanding_balance)
  WHERE deleted_at IS NULL AND status = 'active' AND outstanding_balance > 0;

-- Backfill last_payment_date/amount from most recent paid/partially_paid invoice per resident
UPDATE finance_residents fr SET
  last_payment_date = sub.paid_date,
  last_payment_amount = sub.amount_paid
FROM (
  SELECT DISTINCT ON (resident_id)
    resident_id, paid_date, amount_paid
  FROM finance_invoices
  WHERE resident_id IS NOT NULL AND deleted_at IS NULL
    AND paid_date IS NOT NULL AND status IN ('paid', 'partially_paid')
  ORDER BY resident_id, paid_date DESC, id DESC
) sub WHERE fr.id = sub.resident_id AND fr.deleted_at IS NULL;

-- Backfill outstanding_balance from active invoices (sent, overdue, partially_paid)
UPDATE finance_residents fr SET outstanding_balance = COALESCE(sub.total, 0)
FROM (
  SELECT resident_id, SUM(balance_due) AS total
  FROM finance_invoices
  WHERE resident_id IS NOT NULL AND deleted_at IS NULL
    AND status IN ('sent', 'overdue', 'partially_paid')
    AND balance_due > 0
  GROUP BY resident_id
) sub WHERE fr.id = sub.resident_id AND fr.deleted_at IS NULL;
