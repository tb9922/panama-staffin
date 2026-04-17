CREATE TABLE IF NOT EXISTS cqc_observations (
  id                TEXT         NOT NULL,
  home_id           INTEGER      NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  version           INTEGER      NOT NULL DEFAULT 1,
  quality_statement VARCHAR(10)  NOT NULL
                  CHECK (quality_statement ~ '^(S[1-8]|E[1-6]|C[1-5]|R[1-5]|WL([1-9]|10))$'),
  observed_at       TIMESTAMPTZ  NOT NULL,
  title             VARCHAR(500) NOT NULL,
  area              VARCHAR(200),
  observer          VARCHAR(200),
  notes             TEXT,
  actions           TEXT,
  evidence_owner    VARCHAR(200),
  review_due        DATE,
  added_by          VARCHAR(100),
  added_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_cqc_observations_home_active
  ON cqc_observations(home_id, observed_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cqc_observations_statement_active
  ON cqc_observations(home_id, quality_statement)
  WHERE deleted_at IS NULL;
