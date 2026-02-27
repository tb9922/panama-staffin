-- UP
-- Fee change history: tracks every change to a resident's weekly fee

CREATE TABLE IF NOT EXISTS finance_fee_changes (
  id              SERIAL PRIMARY KEY,
  home_id         INTEGER        NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  resident_id     INTEGER        NOT NULL REFERENCES finance_residents(id) ON DELETE CASCADE,
  effective_date  DATE           NOT NULL,
  previous_weekly NUMERIC(10,2),
  new_weekly      NUMERIC(10,2)  NOT NULL,
  reason          VARCHAR(500),
  approved_by     VARCHAR(200),
  notes           TEXT,
  created_by      VARCHAR(100)   NOT NULL,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fin_fee_changes_resident
  ON finance_fee_changes(resident_id, effective_date DESC);
CREATE INDEX idx_fin_fee_changes_home
  ON finance_fee_changes(home_id);

-- DOWN
DROP TABLE IF EXISTS finance_fee_changes;
