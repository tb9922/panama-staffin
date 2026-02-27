-- UP
-- HR disciplinary cases — ACAS Code of Practice compliant.
-- Tracks full lifecycle: allegation → investigation → suspension → hearing → outcome → appeal.
-- witnesses and evidence_items stored as JSONB — always fetched with the case.
-- deleted_at: soft delete — HR records must be retained 6 years post-employment.

CREATE TABLE IF NOT EXISTS hr_disciplinary_cases (
  id                            SERIAL PRIMARY KEY,
  home_id                       INTEGER        NOT NULL REFERENCES homes(id),
  staff_id                      VARCHAR(20)    NOT NULL,

  -- Case origin
  date_raised                   DATE           NOT NULL,
  raised_by                     VARCHAR(200)   NOT NULL,
  source                        VARCHAR(20)    NOT NULL DEFAULT 'other'
    CHECK (source IN ('incident','complaint','observation','whistleblowing','other')),
  source_ref                    VARCHAR(100),
  category                      VARCHAR(30)    NOT NULL
    CHECK (category IN ('misconduct','gross_misconduct')),

  -- Allegation
  allegation_summary            TEXT           NOT NULL,
  allegation_detail             TEXT,

  -- Investigation
  investigation_status          VARCHAR(20)    NOT NULL DEFAULT 'not_started'
    CHECK (investigation_status IN ('not_started','in_progress','complete')),
  investigation_officer         VARCHAR(200),
  investigation_start_date      DATE,
  investigation_notes           TEXT,
  witnesses                     JSONB          NOT NULL DEFAULT '[]',
  evidence_items                JSONB          NOT NULL DEFAULT '[]',
  investigation_completed_date  DATE,
  investigation_findings        TEXT,
  investigation_recommendation  VARCHAR(30)
    CHECK (investigation_recommendation IN ('no_action','informal_warning','formal_hearing','refer_police','refer_safeguarding')),

  -- Suspension
  suspended                     BOOLEAN        NOT NULL DEFAULT false,
  suspension_date               DATE,
  suspension_reason             TEXT,
  suspension_review_date        DATE,
  suspension_end_date           DATE,
  suspension_on_full_pay        BOOLEAN        DEFAULT true,

  -- Hearing
  hearing_status                VARCHAR(20)    NOT NULL DEFAULT 'not_scheduled'
    CHECK (hearing_status IN ('not_scheduled','scheduled','held','adjourned','cancelled')),
  hearing_date                  DATE,
  hearing_time                  VARCHAR(10),
  hearing_location              VARCHAR(200),
  hearing_chair                 VARCHAR(200),
  hearing_letter_sent_date      DATE,
  hearing_companion_name        VARCHAR(200),
  hearing_companion_role        VARCHAR(30)
    CHECK (hearing_companion_role IN ('colleague','trade_union_rep')),
  hearing_notes                 TEXT,
  hearing_employee_response     TEXT,

  -- Outcome
  outcome                       VARCHAR(30)
    CHECK (outcome IN ('no_action','verbal_warning','first_written','final_written','dismissal','demotion','transfer')),
  outcome_date                  DATE,
  outcome_reason                TEXT,
  outcome_letter_sent_date      DATE,
  outcome_letter_method         VARCHAR(20)
    CHECK (outcome_letter_method IN ('hand_delivered','recorded_post','email')),
  warning_expiry_date           DATE,
  notice_period_start           DATE,
  notice_period_end             DATE,
  pay_in_lieu_of_notice         BOOLEAN        DEFAULT false,
  dismissal_effective_date      DATE,

  -- Appeal
  appeal_status                 VARCHAR(20)    NOT NULL DEFAULT 'none'
    CHECK (appeal_status IN ('none','requested','scheduled','held','decided')),
  appeal_received_date          DATE,
  appeal_deadline               DATE,
  appeal_grounds                TEXT,
  appeal_hearing_date           DATE,
  appeal_hearing_chair          VARCHAR(200),
  appeal_hearing_companion_name VARCHAR(200),
  appeal_outcome                VARCHAR(30)
    CHECK (appeal_outcome IN ('upheld','partially_upheld','overturned')),
  appeal_outcome_date           DATE,
  appeal_outcome_reason         TEXT,
  appeal_outcome_letter_sent_date DATE,

  -- Linked grievance
  linked_grievance_id           INTEGER,
  disciplinary_paused_for_grievance BOOLEAN    DEFAULT false,

  -- Meta
  status                        VARCHAR(30)    NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','investigation','hearing_scheduled','outcome_issued','appeal_pending','appeal_complete','closed','withdrawn')),
  closed_date                   DATE,
  closed_reason                 VARCHAR(50)
    CHECK (closed_reason IN ('resolved','warning_expired','appeal_overturned','employee_left','withdrawn')),
  created_by                    VARCHAR(100)   NOT NULL,
  created_at                    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at                    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hr_disc_home_staff
  ON hr_disciplinary_cases(home_id, staff_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hr_disc_status
  ON hr_disciplinary_cases(home_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hr_disc_warning_expiry
  ON hr_disciplinary_cases(warning_expiry_date) WHERE warning_expiry_date IS NOT NULL AND deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS hr_disciplinary_cases;
