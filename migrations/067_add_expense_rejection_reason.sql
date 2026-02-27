-- 067: Add rejection_reason to finance_expenses
ALTER TABLE finance_expenses ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
