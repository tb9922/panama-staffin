-- UP
-- maintenance: maintenance & environment checks (CQC QS5 — Reg 15).
-- deleted_at: soft delete — regulated compliance records.

CREATE TABLE IF NOT EXISTS maintenance (
  id                  VARCHAR(50)    NOT NULL,
  home_id             INTEGER        NOT NULL REFERENCES homes(id),
  category            VARCHAR(100),
  description         TEXT,
  frequency           VARCHAR(50),
  last_completed      DATE,
  next_due            DATE,
  completed_by        VARCHAR(200),
  contractor          VARCHAR(200),
  items_checked       INTEGER,
  items_passed        INTEGER,
  items_failed        INTEGER,
  certificate_ref     VARCHAR(100),
  certificate_expiry  DATE,
  notes               TEXT,
  updated_at          TIMESTAMP,
  created_at          TIMESTAMP      NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMP,
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_home_due
  ON maintenance(home_id, next_due) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS maintenance;
