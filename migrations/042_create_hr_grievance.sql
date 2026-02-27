-- UP
-- HR grievance cases — ACAS Code of Practice compliant.
-- Tracks: submission → acknowledgement → investigation → hearing → outcome → appeal.
-- hr_grievance_actions: outcome actions tracked separately for completion monitoring.

CREATE TABLE IF NOT EXISTS hr_grievance_cases (
  id                            SERIAL PRIMARY KEY,
  home_id                       INTEGER        NOT NULL REFERENCES homes(id),
  staff_id                      VARCHAR(20)    NOT NULL,

  -- Submission
  date_raised                   DATE           NOT NULL,
  raised_by_method              VARCHAR(20)    NOT NULL
    CHECK (raised_by_method IN ('verbal','written','email')),
  category                      VARCHAR(30)    NOT NULL
    CHECK (category IN ('bullying','harassment','discrimination','pay','working_conditions','management','health_safety','other')),
  protected_characteristic      VARCHAR(30)
    CHECK (protected_characteristic IN ('age','disability','gender_reassignment','marriage','pregnancy','race','religion','sex','sexual_orientation')),
  subject_summary               TEXT           NOT NULL,
  subject_detail                TEXT,
  desired_outcome               TEXT,

  -- Acknowledgement
  acknowledged_date             DATE,
  acknowledge_deadline          DATE,
  acknowledged_by               VARCHAR(200),

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
  employee_statement_at_hearing TEXT,

  -- Outcome
  outcome                       VARCHAR(30)
    CHECK (outcome IN ('upheld','partially_upheld','not_upheld')),
  outcome_date                  DATE,
  outcome_reason                TEXT,
  outcome_letter_sent_date      DATE,
  mediation_offered             BOOLEAN        DEFAULT false,
  mediation_accepted            BOOLEAN        DEFAULT false,
  mediator_name                 VARCHAR(200),

  -- Appeal
  appeal_status                 VARCHAR(20)    NOT NULL DEFAULT 'none'
    CHECK (appeal_status IN ('none','requested','scheduled','held','decided')),
  appeal_received_date          DATE,
  appeal_deadline               DATE,
  appeal_grounds                TEXT,
  appeal_hearing_date           DATE,
  appeal_hearing_chair          VARCHAR(200),
  appeal_outcome                VARCHAR(30)
    CHECK (appeal_outcome IN ('upheld','partially_upheld','overturned')),
  appeal_outcome_date           DATE,
  appeal_outcome_reason         TEXT,
  appeal_outcome_letter_sent_date DATE,

  -- Linked disciplinary
  linked_disciplinary_id        INTEGER,
  triggers_disciplinary         BOOLEAN        DEFAULT false,

  -- Meta
  status                        VARCHAR(30)    NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','acknowledged','investigating','hearing_scheduled','outcome_issued','appeal_pending','appeal_complete','closed','withdrawn')),
  confidential                  BOOLEAN        NOT NULL DEFAULT true,
  closed_date                   DATE,
  closed_reason                 VARCHAR(50),
  created_by                    VARCHAR(100)   NOT NULL,
  created_at                    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at                    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hr_grv_home_staff
  ON hr_grievance_cases(home_id, staff_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hr_grv_status
  ON hr_grievance_cases(home_id, status) WHERE deleted_at IS NULL;

-- Grievance outcome actions
CREATE TABLE IF NOT EXISTS hr_grievance_actions (
  id              SERIAL PRIMARY KEY,
  grievance_id    INTEGER NOT NULL REFERENCES hr_grievance_cases(id),
  description     TEXT NOT NULL,
  responsible     VARCHAR(200),
  due_date        DATE,
  completed_date  DATE,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_grv_actions_case
  ON hr_grievance_actions(grievance_id);

-- DOWN
DROP TABLE IF EXISTS hr_grievance_actions;
DROP TABLE IF EXISTS hr_grievance_cases;
