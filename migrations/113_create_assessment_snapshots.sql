-- UP
-- Assessment snapshots: persisted compliance score calculations for CQC + GDPR.
-- Enables historical audit trail, PDF generation from saved state, and manager sign-off.

CREATE TABLE IF NOT EXISTS assessment_snapshots (
  id              SERIAL       PRIMARY KEY,
  home_id         INTEGER      NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  engine          VARCHAR(20)  NOT NULL CHECK (engine IN ('cqc', 'gdpr')),
  engine_version  VARCHAR(10)  NOT NULL DEFAULT 'v1',
  computed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  window_from     DATE,
  window_to       DATE,
  overall_score   INTEGER,
  band            VARCHAR(30),
  result          JSONB        NOT NULL DEFAULT '{}',
  computed_by     VARCHAR(200),
  input_hash      VARCHAR(64),
  signed_off_by   VARCHAR(200),
  signed_off_at   TIMESTAMPTZ,
  sign_off_notes  TEXT
);

CREATE INDEX IF NOT EXISTS idx_assessment_snapshots_home_engine
  ON assessment_snapshots(home_id, engine, computed_at DESC);

-- DOWN
DROP TABLE IF EXISTS assessment_snapshots;
