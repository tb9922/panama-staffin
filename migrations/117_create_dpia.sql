-- UP
-- Data Protection Impact Assessments (DPIA) — Article 35 UK GDPR.
-- Tracks DPIA lifecycle: screening → assessment → measures → review.

CREATE TABLE IF NOT EXISTS dpia_assessments (
  id                       SERIAL       PRIMARY KEY,
  home_id                  INTEGER      NOT NULL REFERENCES homes(id) ON DELETE CASCADE,

  -- Description
  title                    VARCHAR(300) NOT NULL,
  processing_description   TEXT         NOT NULL,
  purpose                  TEXT,
  scope                    TEXT,

  -- Screening
  screening_result         VARCHAR(20)  NOT NULL DEFAULT 'required'
                           CHECK (screening_result IN ('required','not_required','recommended')),
  screening_rationale      TEXT,
  high_risk_triggers       TEXT,

  -- Necessity & proportionality
  necessity_assessment     TEXT,
  proportionality_assessment TEXT,
  legal_basis              VARCHAR(50)
                           CHECK (legal_basis IS NULL OR legal_basis IN ('consent','contract','legal_obligation','vital_interests','public_task','legitimate_interests')),

  -- Risk assessment
  risk_assessment          TEXT,
  risk_level               VARCHAR(20)  DEFAULT 'medium'
                           CHECK (risk_level IN ('low','medium','high','very_high')),

  -- Measures & safeguards
  measures                 TEXT,
  residual_risk            VARCHAR(20)  DEFAULT 'low'
                           CHECK (residual_risk IN ('low','medium','high','very_high')),

  -- Consultation
  consultation_required    BOOLEAN      NOT NULL DEFAULT false,
  dpo_advice               TEXT,
  dpo_advice_date          DATE,
  ico_consultation         BOOLEAN      NOT NULL DEFAULT false,
  ico_consultation_date    DATE,
  stakeholder_views        TEXT,

  -- Status & review
  status                   VARCHAR(20)  NOT NULL DEFAULT 'screening'
                           CHECK (status IN ('screening','in_progress','completed','approved','review_due')),
  approved_by              VARCHAR(100),
  approved_date            DATE,
  review_date              DATE,
  next_review_due          DATE,
  notes                    TEXT,

  -- Metadata
  version                  INTEGER      NOT NULL DEFAULT 1,
  created_by               VARCHAR(100) NOT NULL,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dpia_home_status
  ON dpia_assessments(home_id, status) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS dpia_assessments;
