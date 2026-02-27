-- UP
-- Incident freeze: once frozen, the incident body is immutable.
-- Post-freeze notes go into incident_addenda (append-only).
-- Protects evidentiary integrity for safeguarding/coroner inquiries.

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS incident_addenda (
  id            SERIAL         PRIMARY KEY,
  incident_id   VARCHAR(50)    NOT NULL,
  home_id       INTEGER        NOT NULL REFERENCES homes(id),
  author        VARCHAR(200)   NOT NULL,
  content       TEXT           NOT NULL,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_addenda_lookup
  ON incident_addenda(home_id, incident_id);

-- DOWN
DROP TABLE IF EXISTS incident_addenda;
ALTER TABLE incidents DROP COLUMN IF EXISTS frozen_at;
