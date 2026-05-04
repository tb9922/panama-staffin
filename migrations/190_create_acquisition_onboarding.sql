-- UP
-- First safe framework for new-home acquisition onboarding/import readiness.
-- This does not touch existing CSV import tables or routes.

CREATE TABLE IF NOT EXISTS acquisition_onboarding_items (
  id              BIGSERIAL PRIMARY KEY,
  home_id         INTEGER     NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  item_key        TEXT        NOT NULL CHECK (
    item_key IN (
      'staff_import',
      'resident_import',
      'training_import',
      'rota_baseline',
      'documents',
      'users',
      'audit_templates',
      'go_live_signoff'
    )
  ),
  title           TEXT        NOT NULL,
  description     TEXT,
  status          TEXT        NOT NULL DEFAULT 'not_started' CHECK (
    status IN ('not_started', 'in_progress', 'blocked', 'ready', 'complete')
  ),
  owner_name      TEXT,
  due_date        DATE,
  expected_count  INTEGER     NOT NULL DEFAULT 0 CHECK (expected_count >= 0),
  imported_count  INTEGER     NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  issue_count     INTEGER     NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
  evidence_ref    TEXT,
  notes           TEXT,
  blockers        TEXT,
  created_by      INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  updated_by      INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  version         INTEGER     NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_acquisition_onboarding_home_key_active
  ON acquisition_onboarding_items(home_id, item_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_acquisition_onboarding_home_status
  ON acquisition_onboarding_items(home_id, status, due_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_acquisition_onboarding_home_updated
  ON acquisition_onboarding_items(home_id, updated_at DESC)
  WHERE deleted_at IS NULL;

INSERT INTO retention_schedule (
  data_category,
  retention_period,
  retention_days,
  retention_basis,
  legal_basis,
  applies_to_table,
  special_category,
  notes
) VALUES (
  'Acquisition onboarding readiness',
  '7 years',
  2555,
  'CQC Reg 17, GDPR Art 5(1)(e)',
  'May contain operational personal data references',
  'acquisition_onboarding_items',
  TRUE,
  'New-home acquisition import and go-live readiness trail; avoid storing raw import files or row-level resident/staff data in notes.'
)
ON CONFLICT (data_category) DO UPDATE SET
  retention_period = EXCLUDED.retention_period,
  retention_days = EXCLUDED.retention_days,
  retention_basis = EXCLUDED.retention_basis,
  legal_basis = EXCLUDED.legal_basis,
  applies_to_table = EXCLUDED.applies_to_table,
  special_category = EXCLUDED.special_category,
  notes = EXCLUDED.notes;

-- DOWN
DROP TABLE IF EXISTS acquisition_onboarding_items;
