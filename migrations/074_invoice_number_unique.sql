-- UP
-- Add unique constraint on (home_id, invoice_number) to prevent duplicate invoice numbers
-- from the race condition in getNextInvoiceNumber when the table is empty.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_invoice_number'
  ) THEN
    ALTER TABLE finance_invoices
      ADD CONSTRAINT uq_invoice_number UNIQUE (home_id, invoice_number);
  END IF;
END;
$$;

-- DOWN
ALTER TABLE finance_invoices DROP CONSTRAINT IF EXISTS uq_invoice_number;
