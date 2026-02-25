-- UP
-- complaints: complaints & feedback (CQC QS23 — Reg 16).
-- deleted_at: soft delete — regulated complaint data must be auditable.

CREATE TABLE IF NOT EXISTS complaints (
  id                    VARCHAR(50)    NOT NULL,
  home_id               INTEGER        NOT NULL REFERENCES homes(id),
  date                  DATE,
  raised_by             VARCHAR(50),
  raised_by_name        VARCHAR(200),
  category              VARCHAR(100),
  title                 VARCHAR(300),
  description           TEXT,
  acknowledged_date     DATE,
  response_deadline     DATE,
  status                VARCHAR(50),
  investigator          VARCHAR(200),
  investigation_notes   TEXT,
  resolution            TEXT,
  resolution_date       DATE,
  outcome_shared        BOOLEAN,
  root_cause            TEXT,
  improvements          TEXT,
  lessons_learned       TEXT,
  reported_by           VARCHAR(200),
  reported_at           TIMESTAMP,
  updated_at            TIMESTAMP,
  created_at            TIMESTAMP      NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMP,
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_complaints_home_date
  ON complaints(home_id, date DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_complaints_home_status
  ON complaints(home_id, status) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS complaints;
