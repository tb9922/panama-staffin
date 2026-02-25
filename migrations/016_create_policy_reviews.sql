-- UP
-- policy_reviews: policy review tracker (CQC QS31 — Reg 17). changes stored as
-- JSONB array — always read as part of the policy record.

CREATE TABLE IF NOT EXISTS policy_reviews (
  id                       VARCHAR(50)    NOT NULL,
  home_id                  INTEGER        NOT NULL REFERENCES homes(id),
  policy_name              VARCHAR(300),
  policy_ref               VARCHAR(100),
  category                 VARCHAR(100),
  version                  VARCHAR(20),
  last_reviewed            DATE,
  next_review_due          DATE,
  review_frequency_months  INTEGER,
  status                   VARCHAR(50),
  reviewed_by              VARCHAR(200),
  approved_by              VARCHAR(200),
  changes                  JSONB          NOT NULL DEFAULT '[]',
  notes                    TEXT,
  updated_at               TIMESTAMP,
  created_at               TIMESTAMP      NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMP,
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_policy_home_due
  ON policy_reviews(home_id, next_review_due) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS policy_reviews;
