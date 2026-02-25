-- UP
-- day_notes: per-date handover/shift notes. Used by DailyStatus.jsx.
-- Simple date → text map. PK on (home_id, date) — one note per day per home.

CREATE TABLE IF NOT EXISTS day_notes (
  home_id     INTEGER    NOT NULL REFERENCES homes(id),
  date        DATE       NOT NULL,
  note        TEXT       NOT NULL DEFAULT '',
  updated_at  TIMESTAMP  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (home_id, date)
);

-- DOWN
DROP TABLE IF EXISTS day_notes;
