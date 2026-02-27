-- UP
-- Invoices (receivables): what the home bills payers for resident care

CREATE TABLE IF NOT EXISTS finance_invoices (
  id                SERIAL PRIMARY KEY,
  home_id           INTEGER        NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  invoice_number    VARCHAR(50)    NOT NULL,
  resident_id       INTEGER        REFERENCES finance_residents(id) ON DELETE SET NULL,

  -- Payer
  payer_type        VARCHAR(20)    NOT NULL
    CHECK (payer_type IN ('resident','la','chc','family','other')),
  payer_name        VARCHAR(200)   NOT NULL,
  payer_reference   VARCHAR(100),

  -- Period & amounts
  period_start      DATE,
  period_end        DATE,
  subtotal          NUMERIC(12,2)  NOT NULL DEFAULT 0,
  adjustments       NUMERIC(12,2)  NOT NULL DEFAULT 0,
  total_amount      NUMERIC(12,2)  NOT NULL DEFAULT 0,
  amount_paid       NUMERIC(12,2)  NOT NULL DEFAULT 0,
  balance_due       NUMERIC(12,2)  NOT NULL DEFAULT 0,

  -- Status & dates
  status            VARCHAR(20)    NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','partially_paid','paid','overdue','void','credited')),
  issue_date        DATE,
  due_date          DATE,
  paid_date         DATE,
  payment_method    VARCHAR(30)
    CHECK (payment_method IS NULL OR payment_method IN ('bacs','cheque','card','cash','direct_debit','other')),
  payment_reference VARCHAR(100),

  notes             TEXT,
  created_by        VARCHAR(100)   NOT NULL,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_fin_invoices_number
  ON finance_invoices(home_id, invoice_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_fin_invoices_home_status
  ON finance_invoices(home_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_fin_invoices_home_due
  ON finance_invoices(home_id, due_date)
  WHERE deleted_at IS NULL AND status NOT IN ('paid','void','credited');
CREATE INDEX idx_fin_invoices_resident
  ON finance_invoices(resident_id) WHERE deleted_at IS NULL;

-- Invoice line items
CREATE TABLE IF NOT EXISTS finance_invoice_lines (
  id            SERIAL PRIMARY KEY,
  invoice_id    INTEGER        NOT NULL REFERENCES finance_invoices(id) ON DELETE CASCADE,
  description   VARCHAR(500)   NOT NULL,
  quantity      NUMERIC(8,2)   NOT NULL DEFAULT 1,
  unit_price    NUMERIC(10,2)  NOT NULL,
  amount        NUMERIC(12,2)  NOT NULL,
  line_type     VARCHAR(30)    NOT NULL DEFAULT 'fee'
    CHECK (line_type IN ('fee','top_up','fnc','additional','adjustment','credit'))
);

CREATE INDEX idx_fin_inv_lines_invoice ON finance_invoice_lines(invoice_id);

-- DOWN
DROP TABLE IF EXISTS finance_invoice_lines;
DROP TABLE IF EXISTS finance_invoices;
