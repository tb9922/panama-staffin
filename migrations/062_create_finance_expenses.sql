-- UP
-- Expenses (payables): what the home owes to suppliers and service providers

CREATE TABLE IF NOT EXISTS finance_expenses (
  id                  SERIAL PRIMARY KEY,
  home_id             INTEGER        NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  expense_date        DATE           NOT NULL,
  category            VARCHAR(50)    NOT NULL
    CHECK (category IN (
      'staffing','agency','food','utilities','maintenance','medical_supplies',
      'cleaning','insurance','rent','rates','training','equipment',
      'professional_fees','transport','laundry','other'
    )),
  subcategory         VARCHAR(100),
  description         VARCHAR(500)   NOT NULL,
  supplier            VARCHAR(200),
  invoice_ref         VARCHAR(100),

  -- Amounts (NUMERIC for exact decimal)
  net_amount          NUMERIC(12,2)  NOT NULL,
  vat_amount          NUMERIC(12,2)  NOT NULL DEFAULT 0,
  gross_amount        NUMERIC(12,2)  NOT NULL,

  -- Approval & payment
  status              VARCHAR(20)    NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','paid','void')),
  approved_by         VARCHAR(200),
  approved_date       DATE,
  paid_date           DATE,
  payment_method      VARCHAR(30)
    CHECK (payment_method IS NULL OR payment_method IN ('bacs','cheque','card','cash','direct_debit','petty_cash','other')),
  payment_reference   VARCHAR(100),

  -- Recurrence
  recurring           BOOLEAN        NOT NULL DEFAULT false,
  recurrence_frequency VARCHAR(20)
    CHECK (recurrence_frequency IS NULL OR recurrence_frequency IN ('weekly','monthly','quarterly','annually')),

  notes               TEXT,
  created_by          VARCHAR(100)   NOT NULL,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_fin_expenses_home_date
  ON finance_expenses(home_id, expense_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_fin_expenses_home_category
  ON finance_expenses(home_id, category) WHERE deleted_at IS NULL;
CREATE INDEX idx_fin_expenses_home_status
  ON finance_expenses(home_id, status) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS finance_expenses;
