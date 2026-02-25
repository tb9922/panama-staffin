-- UP
-- complaint_surveys: satisfaction surveys. area_scores stored as JSONB
-- (keys vary by survey type — not worth normalising at this scale).

CREATE TABLE IF NOT EXISTS complaint_surveys (
  id                    VARCHAR(50)    NOT NULL,
  home_id               INTEGER        NOT NULL REFERENCES homes(id),
  type                  VARCHAR(50),
  date                  DATE,
  title                 VARCHAR(300),
  total_sent            INTEGER,
  responses             INTEGER,
  overall_satisfaction  NUMERIC(3,1),
  area_scores           JSONB          NOT NULL DEFAULT '{}',
  key_feedback          TEXT,
  actions               TEXT,
  conducted_by          VARCHAR(200),
  reported_at           TIMESTAMP,
  created_at            TIMESTAMP      NOT NULL DEFAULT NOW(),
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_surveys_home_date
  ON complaint_surveys(home_id, date DESC);

-- DOWN
DROP TABLE IF EXISTS complaint_surveys;
