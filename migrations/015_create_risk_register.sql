-- UP
-- risk_register: risk register (CQC QS31 — Reg 17). controls and actions stored
-- as JSONB — always read as part of the risk, not queried independently.

CREATE TABLE IF NOT EXISTS risk_register (
  id                    VARCHAR(50)    NOT NULL,
  home_id               INTEGER        NOT NULL REFERENCES homes(id),
  title                 VARCHAR(300),
  description           TEXT,
  category              VARCHAR(100),
  owner                 VARCHAR(200),
  likelihood            INTEGER,
  impact                INTEGER,
  inherent_risk         INTEGER,
  controls              JSONB          NOT NULL DEFAULT '[]',
  residual_likelihood   INTEGER,
  residual_impact       INTEGER,
  residual_risk         INTEGER,
  actions               JSONB          NOT NULL DEFAULT '[]',
  last_reviewed         DATE,
  next_review           DATE,
  status                VARCHAR(50),
  created_at            TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP,
  deleted_at            TIMESTAMP,
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_risk_home_status
  ON risk_register(home_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_risk_home_review
  ON risk_register(home_id, next_review) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS risk_register;
