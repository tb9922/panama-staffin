-- UP
-- ipc_audits: IPC audit records (CQC QS7 — Reg 12). risk_areas, corrective_actions,
-- and outbreak stored as JSONB — always read as part of the audit, not queried
-- independently. deleted_at: soft delete.

CREATE TABLE IF NOT EXISTS ipc_audits (
  id                  VARCHAR(50)    NOT NULL,
  home_id             INTEGER        NOT NULL REFERENCES homes(id),
  audit_date          DATE,
  audit_type          VARCHAR(100),
  auditor             VARCHAR(200),
  overall_score       NUMERIC(5,2),
  compliance_pct      NUMERIC(5,2),
  risk_areas          JSONB          NOT NULL DEFAULT '[]',
  corrective_actions  JSONB          NOT NULL DEFAULT '[]',
  outbreak            JSONB          NOT NULL DEFAULT '{}',
  notes               TEXT,
  reported_at         TIMESTAMP,
  updated_at          TIMESTAMP,
  created_at          TIMESTAMP      NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMP,
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_ipc_audits_home_date
  ON ipc_audits(home_id, audit_date DESC) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS ipc_audits;
