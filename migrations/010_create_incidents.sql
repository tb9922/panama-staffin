-- UP
-- incidents: incident & safety reporting (CQC Reg 12, RIDDOR). Scalar fields
-- normalised. witnesses and corrective_actions stored as JSONB — always fetched
-- as part of the incident record, never queried independently.
-- deleted_at: soft delete — regulated incident data must be auditable.

CREATE TABLE IF NOT EXISTS incidents (
  id                            VARCHAR(50)    NOT NULL,
  home_id                       INTEGER        NOT NULL REFERENCES homes(id),
  date                          DATE,
  time                          TIME,
  location                      VARCHAR(200),
  type                          VARCHAR(100),
  severity                      VARCHAR(50),
  description                   TEXT,
  person_affected               VARCHAR(50),
  person_affected_name          VARCHAR(200),
  staff_involved                JSONB          NOT NULL DEFAULT '[]',
  immediate_action              TEXT,
  medical_attention             BOOLEAN,
  hospital_attendance           BOOLEAN,
  cqc_notifiable                BOOLEAN        NOT NULL DEFAULT false,
  cqc_notification_type         VARCHAR(100),
  cqc_notification_deadline     TIMESTAMP,
  cqc_notified                  BOOLEAN        NOT NULL DEFAULT false,
  cqc_notified_date             DATE,
  cqc_reference                 VARCHAR(100),
  riddor_reportable             BOOLEAN        NOT NULL DEFAULT false,
  riddor_category               VARCHAR(100),
  riddor_reported               BOOLEAN        NOT NULL DEFAULT false,
  riddor_reported_date          DATE,
  riddor_reference              VARCHAR(100),
  safeguarding_referral         BOOLEAN        NOT NULL DEFAULT false,
  safeguarding_to               VARCHAR(200),
  safeguarding_reference        VARCHAR(100),
  safeguarding_date             DATE,
  witnesses                     JSONB          NOT NULL DEFAULT '[]',
  duty_of_candour_applies       BOOLEAN        NOT NULL DEFAULT false,
  candour_notification_date     DATE,
  candour_letter_sent_date      DATE,
  candour_recipient             VARCHAR(200),
  police_involved               BOOLEAN        NOT NULL DEFAULT false,
  police_reference              VARCHAR(100),
  police_contact_date           DATE,
  msp_wishes_recorded           BOOLEAN,
  msp_outcome_preferences       TEXT,
  msp_person_involved           VARCHAR(200),
  investigation_status          VARCHAR(50)    NOT NULL DEFAULT 'open',
  investigation_start_date      DATE,
  investigation_lead            VARCHAR(200),
  investigation_review_date     DATE,
  root_cause                    TEXT,
  lessons_learned               TEXT,
  investigation_closed_date     DATE,
  corrective_actions            JSONB          NOT NULL DEFAULT '[]',
  reported_by                   VARCHAR(200),
  reported_at                   TIMESTAMP,
  updated_at                    TIMESTAMP,
  created_at                    TIMESTAMP      NOT NULL DEFAULT NOW(),
  deleted_at                    TIMESTAMP,
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_incidents_home_date
  ON incidents(home_id, date DESC) WHERE deleted_at IS NULL;

-- CQC notification overdue check
CREATE INDEX IF NOT EXISTS idx_incidents_cqc
  ON incidents(home_id, cqc_notifiable, cqc_notified) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS incidents;
