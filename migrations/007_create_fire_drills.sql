-- UP
-- fire_drills: home-level quarterly fire drill records. staff_present is a JSONB
-- array of staff ID strings — not normalised as it's a snapshot reference, not
-- a live FK relationship. Queried by date for compliance checks.

CREATE TABLE IF NOT EXISTS fire_drills (
  id                          VARCHAR(50)   NOT NULL,
  home_id                     INTEGER       NOT NULL REFERENCES homes(id),
  date                        DATE          NOT NULL,
  time                        TIME,
  scenario                    TEXT,
  evacuation_time_seconds     INTEGER,
  staff_present               JSONB         NOT NULL DEFAULT '[]',
  residents_evacuated         INTEGER,
  issues                      TEXT,
  corrective_actions          TEXT,
  conducted_by                VARCHAR(200),
  notes                       TEXT,
  created_at                  TIMESTAMP     NOT NULL DEFAULT NOW(),
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_fire_drills_home_date
  ON fire_drills(home_id, date DESC);

-- DOWN
DROP TABLE IF EXISTS fire_drills;
