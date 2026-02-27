-- UP
CREATE TABLE IF NOT EXISTS finance_payment_schedule (
  id            SERIAL PRIMARY KEY,
  home_id       INTEGER        NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  supplier      VARCHAR(200)   NOT NULL,
  category      VARCHAR(50)    NOT NULL
    CHECK (category IN ('staffing','agency','food','utilities','maintenance','medical_supplies','cleaning','insurance','rent','rates','training','equipment','professional_fees','transport','laundry','other')),
  description   TEXT,
  frequency     VARCHAR(20)    NOT NULL
    CHECK (frequency IN ('weekly','monthly','quarterly','annually')),
  amount        NUMERIC(12,2)  NOT NULL,
  next_due      DATE           NOT NULL,
  auto_approve  BOOLEAN        NOT NULL DEFAULT false,
  on_hold       BOOLEAN        NOT NULL DEFAULT false,
  hold_reason   TEXT,
  notes         TEXT,
  created_by    VARCHAR(100)   NOT NULL,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_fin_payment_sched_home_due ON finance_payment_schedule(home_id, next_due) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_updated_at_finance_payment_schedule ON finance_payment_schedule;
CREATE TRIGGER trg_updated_at_finance_payment_schedule
  BEFORE UPDATE ON finance_payment_schedule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS trg_updated_at_finance_payment_schedule ON finance_payment_schedule;
DROP TABLE IF EXISTS finance_payment_schedule;
