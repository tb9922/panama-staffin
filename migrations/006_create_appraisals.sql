-- UP
-- appraisals: per-staff annual appraisal records. Same structure as supervisions.

CREATE TABLE IF NOT EXISTS appraisals (
  id               VARCHAR(50)   NOT NULL,
  home_id          INTEGER       NOT NULL REFERENCES homes(id),
  staff_id         VARCHAR(20)   NOT NULL,
  date             DATE          NOT NULL,
  appraiser        VARCHAR(200),
  objectives       TEXT,
  training_needs   TEXT,
  development_plan TEXT,
  next_due         DATE,
  notes            TEXT,
  created_at       TIMESTAMP     NOT NULL DEFAULT NOW(),
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_appraisals_home_staff
  ON appraisals(home_id, staff_id);

-- DOWN
DROP TABLE IF EXISTS appraisals;
