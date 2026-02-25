-- UP
-- handover_entries: structured shift handover records (CQC Reg 17 — accurate contemporaneous records).
-- Separate from day_notes (quick inline textarea). Each entry carries shift, category, priority,
-- author (set server-side from JWT) and optional incident link.

CREATE TABLE IF NOT EXISTS handover_entries (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  home_id      INTEGER      NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  entry_date   DATE         NOT NULL,
  shift        VARCHAR(4)   NOT NULL CHECK (shift IN ('E', 'L', 'N')),
  category     VARCHAR(20)  NOT NULL CHECK (category IN ('clinical', 'safety', 'operational', 'admin')),
  priority     VARCHAR(10)  NOT NULL CHECK (priority IN ('urgent', 'action', 'info')),
  content      TEXT         NOT NULL,
  incident_id  VARCHAR(50),
  author       VARCHAR(100) NOT NULL,
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS handover_entries_home_date_idx ON handover_entries (home_id, entry_date, shift);
