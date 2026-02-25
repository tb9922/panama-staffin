-- UP
-- cqc_evidence: manual evidence items tagged to CQC quality statements.
-- deleted_at: soft delete — evidence trail must be auditable.

CREATE TABLE IF NOT EXISTS cqc_evidence (
  id                  VARCHAR(50)    NOT NULL,
  home_id             INTEGER        NOT NULL REFERENCES homes(id),
  quality_statement   VARCHAR(10)    NOT NULL,
  type                VARCHAR(50),
  title               VARCHAR(300),
  description         TEXT,
  date_from           DATE,
  date_to             DATE,
  added_by            VARCHAR(200),
  added_at            TIMESTAMP,
  created_at          TIMESTAMP      NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMP,
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_cqc_evidence_home_statement
  ON cqc_evidence(home_id, quality_statement) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS cqc_evidence;
