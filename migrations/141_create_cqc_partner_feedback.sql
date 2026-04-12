CREATE TABLE IF NOT EXISTS cqc_partner_feedback (
  id                TEXT         NOT NULL,
  home_id           INTEGER      NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  version           INTEGER      NOT NULL DEFAULT 1,
  quality_statement VARCHAR(10)  NOT NULL
                  CHECK (quality_statement ~ '^(S[1-8]|E[1-6]|C[1-5]|R[1-5]|WL([1-9]|10))$'),
  feedback_date     DATE         NOT NULL,
  title             VARCHAR(500) NOT NULL,
  partner_name      VARCHAR(200),
  partner_role      VARCHAR(100),
  relationship      VARCHAR(200),
  summary           TEXT,
  response_action   TEXT,
  evidence_owner    VARCHAR(200),
  review_due        DATE,
  added_by          VARCHAR(100),
  added_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_cqc_partner_feedback_home_active
  ON cqc_partner_feedback(home_id, feedback_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cqc_partner_feedback_statement_active
  ON cqc_partner_feedback(home_id, quality_statement)
  WHERE deleted_at IS NULL;
