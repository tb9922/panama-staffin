-- UP
-- HR case notes — shared audit trail across all HR case types.
-- Append-only: notes are never updated or deleted. Tribunal-proof record.

CREATE TABLE IF NOT EXISTS hr_case_notes (
  id              SERIAL PRIMARY KEY,
  home_id         INTEGER        NOT NULL REFERENCES homes(id),
  case_type       VARCHAR(30)    NOT NULL
    CHECK (case_type IN ('disciplinary','grievance','performance')),
  case_id         INTEGER        NOT NULL,
  note_type       VARCHAR(30)    NOT NULL DEFAULT 'note'
    CHECK (note_type IN ('note','status_change','meeting_record','evidence','decision','letter_sent')),
  content         TEXT           NOT NULL,
  author          VARCHAR(200)   NOT NULL,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_case_notes_case
  ON hr_case_notes(case_type, case_id);
CREATE INDEX IF NOT EXISTS idx_hr_case_notes_home
  ON hr_case_notes(home_id);

-- DOWN
DROP TABLE IF EXISTS hr_case_notes;
