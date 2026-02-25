-- UP
-- dols: DoLS/LPS applications (CQC QS3/QS14 — Reg 11/13) — tracks residents.
-- GDPR special category: resident DoB, room number, capacity restrictions.
-- Viewer role must NOT receive this table (stripped in homeService.assembleData).
-- restrictions stored as JSONB array.

CREATE TABLE IF NOT EXISTS dols (
  id                    VARCHAR(50)    NOT NULL,
  home_id               INTEGER        NOT NULL REFERENCES homes(id),
  resident_name         VARCHAR(200),
  dob                   DATE,
  room_number           VARCHAR(20),
  application_type      VARCHAR(20),
  application_date      DATE,
  authorised            BOOLEAN,
  authorisation_date    DATE,
  expiry_date           DATE,
  authorisation_number  VARCHAR(100),
  authorising_authority VARCHAR(200),
  restrictions          JSONB          NOT NULL DEFAULT '[]',
  reviewed_date         DATE,
  review_status         VARCHAR(50),
  next_review_date      DATE,
  notes                 TEXT,
  updated_at            TIMESTAMP,
  created_at            TIMESTAMP      NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMP,
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_dols_home_expiry
  ON dols(home_id, expiry_date) WHERE deleted_at IS NULL;

-- mca_assessments: Mental Capacity Act assessments — also special category data.
CREATE TABLE IF NOT EXISTS mca_assessments (
  id                    VARCHAR(50)    NOT NULL,
  home_id               INTEGER        NOT NULL REFERENCES homes(id),
  resident_name         VARCHAR(200),
  assessment_date       DATE,
  assessor              VARCHAR(200),
  decision_area         TEXT,
  lacks_capacity        BOOLEAN,
  best_interest_decision TEXT,
  next_review_date      DATE,
  notes                 TEXT,
  updated_at            TIMESTAMP,
  created_at            TIMESTAMP      NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMP,
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_mca_home_review
  ON mca_assessments(home_id, next_review_date) WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS mca_assessments;
DROP TABLE IF EXISTS dols;
