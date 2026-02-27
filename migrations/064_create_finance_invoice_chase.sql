-- UP
CREATE TABLE IF NOT EXISTS finance_invoice_chase (
  id            SERIAL PRIMARY KEY,
  home_id       INTEGER        NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  invoice_id    INTEGER        NOT NULL REFERENCES finance_invoices(id) ON DELETE CASCADE,
  chase_date    DATE           NOT NULL,
  method        VARCHAR(20)    NOT NULL
    CHECK (method IN ('email','phone','letter','in_person','other')),
  contact_name  VARCHAR(200),
  outcome       TEXT,
  next_action_date DATE,
  notes         TEXT,
  created_by    VARCHAR(100)   NOT NULL,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_fin_chase_invoice ON finance_invoice_chase(invoice_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_fin_chase_home_next ON finance_invoice_chase(home_id, next_action_date) WHERE deleted_at IS NULL AND next_action_date IS NOT NULL;

-- DOWN
DROP TABLE IF EXISTS finance_invoice_chase;
