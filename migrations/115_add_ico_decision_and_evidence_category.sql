-- UP
-- ICO breach decision-record fields on data_breaches (UK GDPR best practice).
-- Evidence category on cqc_evidence (CQC Single Assessment Framework).

ALTER TABLE data_breaches
  ADD COLUMN IF NOT EXISTS recommended_ico_notification BOOLEAN,
  ADD COLUMN IF NOT EXISTS manual_decision              BOOLEAN,
  ADD COLUMN IF NOT EXISTS decision_by                  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS decision_at                  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_rationale           TEXT;

ALTER TABLE cqc_evidence
  ADD COLUMN IF NOT EXISTS evidence_category VARCHAR(30)
    CHECK (evidence_category IN (
      'peoples_experience', 'feedback', 'observation',
      'processes', 'outcomes', 'management_info'
    ));

-- DOWN
ALTER TABLE data_breaches
  DROP COLUMN IF EXISTS recommended_ico_notification,
  DROP COLUMN IF EXISTS manual_decision,
  DROP COLUMN IF EXISTS decision_by,
  DROP COLUMN IF EXISTS decision_at,
  DROP COLUMN IF EXISTS decision_rationale;

ALTER TABLE cqc_evidence
  DROP COLUMN IF EXISTS evidence_category;
