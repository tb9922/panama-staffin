-- UP
-- Platform-admin access reviews snapshot account and home-role state without
-- storing passwords, password hashes, tokens, or secrets.

CREATE TABLE IF NOT EXISTS access_reviews (
  id                   BIGSERIAL PRIMARY KEY,
  review_key           TEXT        NOT NULL UNIQUE,
  cadence              TEXT        NOT NULL CHECK (cadence IN ('monthly', 'quarterly')),
  period_start         DATE        NOT NULL,
  period_end           DATE        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'in_progress'
                         CHECK (status IN ('in_progress', 'completed')),
  snapshot             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  started_by_username  VARCHAR(100) NOT NULL REFERENCES users(username) ON UPDATE CASCADE,
  completed_by_username VARCHAR(100) REFERENCES users(username) ON UPDATE CASCADE,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_access_reviews_status_period
  ON access_reviews(status, period_start DESC, id DESC);

CREATE TABLE IF NOT EXISTS access_review_assignments (
  id                   BIGSERIAL PRIMARY KEY,
  review_id            BIGINT      NOT NULL REFERENCES access_reviews(id) ON DELETE CASCADE,
  assignment_key       TEXT        NOT NULL,
  assignment_type      TEXT        NOT NULL CHECK (assignment_type IN ('home_role', 'user_exception')),
  user_id              INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  username             VARCHAR(100) NOT NULL,
  display_name         VARCHAR(200),
  user_role            VARCHAR(20),
  active               BOOLEAN     NOT NULL DEFAULT true,
  is_platform_admin    BOOLEAN     NOT NULL DEFAULT false,
  last_login_at        TIMESTAMPTZ,
  home_id              INTEGER     REFERENCES homes(id) ON DELETE SET NULL,
  home_slug            TEXT,
  home_name            TEXT,
  role_id              VARCHAR(30),
  exception_flags      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  status               TEXT        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'reviewed', 'needs_change', 'revoked_requested')),
  notes                TEXT,
  reviewed_by_username VARCHAR(100) REFERENCES users(username) ON UPDATE CASCADE,
  reviewed_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (review_id, assignment_key)
);

CREATE INDEX IF NOT EXISTS idx_access_review_assignments_review_status
  ON access_review_assignments(review_id, status, id);

CREATE INDEX IF NOT EXISTS idx_access_review_assignments_username
  ON access_review_assignments(username, review_id);

INSERT INTO retention_schedule (
  data_category,
  retention_period,
  retention_days,
  retention_basis,
  legal_basis,
  applies_to_table,
  special_category,
  notes
) VALUES (
  'Platform access reviews',
  '7 years',
  2555,
  'CQC Reg 17, GDPR Art 5(1)(f), UK GDPR accountability',
  'Legitimate interests and legal obligation',
  'access_reviews, access_review_assignments',
  FALSE,
  'Quarterly/monthly role and access certification trail. Stores only account metadata and decisions; no passwords, tokens, or secrets.'
)
ON CONFLICT (data_category) DO UPDATE SET
  retention_period = EXCLUDED.retention_period,
  retention_days = EXCLUDED.retention_days,
  retention_basis = EXCLUDED.retention_basis,
  legal_basis = EXCLUDED.legal_basis,
  applies_to_table = EXCLUDED.applies_to_table,
  special_category = EXCLUDED.special_category,
  notes = EXCLUDED.notes;

-- DOWN
DROP TABLE IF EXISTS access_review_assignments;
DROP TABLE IF EXISTS access_reviews;
