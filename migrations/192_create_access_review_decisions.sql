-- UP
-- Append-only decision history for platform access reviews. This preserves the
-- full certification trail even if the current assignment status is changed.

CREATE TABLE IF NOT EXISTS access_review_decisions (
  id                    BIGSERIAL PRIMARY KEY,
  review_id             BIGINT       NOT NULL REFERENCES access_reviews(id) ON DELETE CASCADE,
  assignment_id         BIGINT       NOT NULL REFERENCES access_review_assignments(id) ON DELETE CASCADE,
  assignment_key        TEXT         NOT NULL,
  from_status           TEXT,
  to_status             TEXT         NOT NULL CHECK (to_status IN ('pending', 'reviewed', 'needs_change', 'revoked_requested')),
  notes                 TEXT,
  decided_by_username   VARCHAR(100) NOT NULL REFERENCES users(username) ON UPDATE CASCADE,
  decided_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_review_decisions_review_assignment
  ON access_review_decisions(review_id, assignment_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS idx_access_review_decisions_decided_by
  ON access_review_decisions(decided_by_username, decided_at DESC);

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
  'Platform access review decisions',
  '7 years',
  2555,
  'CQC Reg 17, GDPR Art 5(1)(f), UK GDPR accountability',
  'Legitimate interests and legal obligation',
  'access_review_decisions',
  FALSE,
  'Append-only certification decisions for platform and home-role access reviews.'
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
DROP TABLE IF EXISTS access_review_decisions;
