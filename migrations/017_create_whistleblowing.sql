-- UP
-- whistleblowing_concerns: whistleblowing / speak up (CQC QS29 — Reg 17).
-- deleted_at: soft delete — regulated data.

CREATE TABLE IF NOT EXISTS whistleblowing_concerns (
  id                        VARCHAR(50)    NOT NULL,
  home_id                   INTEGER        NOT NULL REFERENCES homes(id),
  date_raised               DATE,
  raised_by_role            VARCHAR(100),
  anonymous                 BOOLEAN,
  category                  VARCHAR(100),
  description               TEXT,
  severity                  VARCHAR(50),
  status                    VARCHAR(50),
  acknowledgement_date      DATE,
  investigator              VARCHAR(200),
  investigation_start_date  DATE,
  findings                  TEXT,
  outcome                   VARCHAR(100),
  outcome_details           TEXT,
  reporter_protected        BOOLEAN,
  protection_details        TEXT,
  follow_up_date            DATE,
  follow_up_completed       BOOLEAN,
  resolution_date           DATE,
  lessons_learned           TEXT,
  reported_at               TIMESTAMP,
  updated_at                TIMESTAMP,
  created_at                TIMESTAMP      NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMP,
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_whistleblowing_home_status
  ON whistleblowing_concerns(home_id, status) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS whistleblowing_concerns;
