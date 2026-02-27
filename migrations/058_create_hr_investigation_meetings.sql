-- UP
CREATE TABLE IF NOT EXISTS hr_investigation_meetings (
  id              SERIAL PRIMARY KEY,
  home_id         INTEGER        NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  case_type       VARCHAR(30)    NOT NULL
    CHECK (case_type IN ('disciplinary','grievance','performance')),
  case_id         INTEGER        NOT NULL,
  meeting_date    DATE           NOT NULL,
  meeting_time    VARCHAR(10),
  meeting_type    VARCHAR(30)    NOT NULL DEFAULT 'interview'
    CHECK (meeting_type IN ('interview','hearing','review','informal')),
  location        VARCHAR(200),
  attendees       JSONB          NOT NULL DEFAULT '[]',
  summary         TEXT,
  key_points      TEXT,
  outcome         TEXT,
  recorded_by     VARCHAR(200)   NOT NULL,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_meetings_case ON hr_investigation_meetings(case_type, case_id);
CREATE INDEX IF NOT EXISTS idx_hr_meetings_home ON hr_investigation_meetings(home_id);

-- Apply updated_at trigger (set_updated_at function created in migration 056)
CREATE TRIGGER trg_updated_at_hr_investigation_meetings
  BEFORE UPDATE ON hr_investigation_meetings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS trg_updated_at_hr_investigation_meetings ON hr_investigation_meetings;
DROP TABLE IF EXISTS hr_investigation_meetings;
