-- UP
-- supervisions: per-staff 1:1 supervision records. id is the application-generated
-- string "sup-{timestamp}". Multiple sessions per staff member (array per staffId).

CREATE TABLE IF NOT EXISTS supervisions (
  id          VARCHAR(50)   NOT NULL,
  home_id     INTEGER       NOT NULL REFERENCES homes(id),
  staff_id    VARCHAR(20)   NOT NULL,
  date        DATE          NOT NULL,
  supervisor  VARCHAR(200),
  topics      TEXT,
  actions     TEXT,
  next_due    DATE,
  notes       TEXT,
  created_at  TIMESTAMP     NOT NULL DEFAULT NOW(),
  PRIMARY KEY (home_id, id)
);

CREATE INDEX IF NOT EXISTS idx_supervisions_home_staff
  ON supervisions(home_id, staff_id);

-- DOWN
DROP TABLE IF EXISTS supervisions;
