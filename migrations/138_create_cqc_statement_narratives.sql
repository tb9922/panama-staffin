CREATE TABLE IF NOT EXISTS cqc_statement_narratives (
  id SERIAL PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  quality_statement VARCHAR(10) NOT NULL,
  narrative TEXT,
  risks TEXT,
  actions TEXT,
  reviewed_by VARCHAR(200),
  reviewed_at TIMESTAMPTZ,
  review_due DATE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (home_id, quality_statement),
  CHECK (quality_statement ~ '^(S[1-8]|E[1-6]|C[1-5]|R[1-5]|WL([1-9]|10))$')
);

CREATE INDEX IF NOT EXISTS idx_cqc_statement_narratives_home
  ON cqc_statement_narratives(home_id, quality_statement);
