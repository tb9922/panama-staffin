-- UP
-- CQC evidence categories: tag manual evidence with one of 6 CQC categories
ALTER TABLE cqc_evidence ADD COLUMN IF NOT EXISTS evidence_category VARCHAR(30)
  CHECK (evidence_category IS NULL OR evidence_category IN (
    'peoples_experience', 'feedback', 'observation', 'processes', 'outcomes', 'management_info'
  ));

-- ICO breach decision record: replace hard icoNotifiable boolean with reviewed decision
ALTER TABLE data_breaches ADD COLUMN IF NOT EXISTS recommended_ico_notification BOOLEAN;
ALTER TABLE data_breaches ADD COLUMN IF NOT EXISTS manual_decision BOOLEAN;
ALTER TABLE data_breaches ADD COLUMN IF NOT EXISTS decision_by VARCHAR(100);
ALTER TABLE data_breaches ADD COLUMN IF NOT EXISTS decision_at TIMESTAMPTZ;
ALTER TABLE data_breaches ADD COLUMN IF NOT EXISTS decision_rationale TEXT;

-- DOWN
ALTER TABLE cqc_evidence DROP COLUMN IF EXISTS evidence_category;
ALTER TABLE data_breaches DROP COLUMN IF EXISTS recommended_ico_notification;
ALTER TABLE data_breaches DROP COLUMN IF EXISTS manual_decision;
ALTER TABLE data_breaches DROP COLUMN IF EXISTS decision_by;
ALTER TABLE data_breaches DROP COLUMN IF EXISTS decision_at;
ALTER TABLE data_breaches DROP COLUMN IF EXISTS decision_rationale;
