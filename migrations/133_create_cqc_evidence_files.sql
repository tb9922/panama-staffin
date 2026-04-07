-- UP
CREATE TABLE IF NOT EXISTS cqc_evidence_files (
  id              SERIAL PRIMARY KEY,
  home_id         INTEGER        NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  evidence_id     VARCHAR(50)    NOT NULL,
  original_name   VARCHAR(500)   NOT NULL,
  stored_name     VARCHAR(200)   NOT NULL,
  mime_type       VARCHAR(100)   NOT NULL,
  size_bytes      INTEGER        NOT NULL CHECK (size_bytes >= 0),
  description     TEXT,
  uploaded_by     VARCHAR(200)   NOT NULL,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT fk_cqc_evidence_files_evidence
    FOREIGN KEY (home_id, evidence_id)
    REFERENCES cqc_evidence(home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_cqc_evidence_files_lookup
  ON cqc_evidence_files(home_id, evidence_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cqc_evidence_files_home
  ON cqc_evidence_files(home_id);

-- DOWN
DROP TABLE IF EXISTS cqc_evidence_files;
