ALTER TABLE cqc_evidence
  ADD COLUMN IF NOT EXISTS evidence_owner VARCHAR(200),
  ADD COLUMN IF NOT EXISTS review_due DATE;

CREATE INDEX IF NOT EXISTS idx_cqc_evidence_review_due
  ON cqc_evidence(home_id, review_due)
  WHERE deleted_at IS NULL AND review_due IS NOT NULL;
