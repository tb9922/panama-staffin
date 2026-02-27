-- Migration 066: Finance schema hardening
-- Adds defense-in-depth constraints, invoice_lines improvements, funding_type index, rejection tracking

-- (a) invoice_lines: add home_id, timestamps, soft-delete
ALTER TABLE finance_invoice_lines
  ADD COLUMN IF NOT EXISTS home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Backfill home_id from parent invoices
UPDATE finance_invoice_lines l
  SET home_id = i.home_id
  FROM finance_invoices i
  WHERE l.invoice_id = i.id AND l.home_id IS NULL;

ALTER TABLE finance_invoice_lines
  ALTER COLUMN home_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fin_inv_lines_home
  ON finance_invoice_lines(home_id) WHERE deleted_at IS NULL;

-- (b) CHECK constraints on amounts and date ordering
ALTER TABLE finance_residents
  ADD CONSTRAINT chk_fin_residents_fee    CHECK (weekly_fee >= 0),
  ADD CONSTRAINT chk_fin_residents_la     CHECK (la_contribution >= 0),
  ADD CONSTRAINT chk_fin_residents_chc    CHECK (chc_contribution >= 0),
  ADD CONSTRAINT chk_fin_residents_fnc    CHECK (fnc_amount >= 0),
  ADD CONSTRAINT chk_fin_residents_topup  CHECK (top_up_amount >= 0);

ALTER TABLE finance_invoices
  ADD CONSTRAINT chk_fin_invoices_period
    CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end);

ALTER TABLE finance_expenses
  ADD CONSTRAINT chk_fin_expenses_net   CHECK (net_amount >= 0),
  ADD CONSTRAINT chk_fin_expenses_vat   CHECK (vat_amount >= 0),
  ADD CONSTRAINT chk_fin_expenses_gross CHECK (gross_amount >= 0);

-- (c) Index on funding_type for filtering at scale
CREATE INDEX IF NOT EXISTS idx_fin_residents_funding
  ON finance_residents(home_id, funding_type) WHERE deleted_at IS NULL;

-- (d) Rejected expense tracking columns
ALTER TABLE finance_expenses
  ADD COLUMN IF NOT EXISTS rejected_by   VARCHAR(200),
  ADD COLUMN IF NOT EXISTS rejected_date DATE;
