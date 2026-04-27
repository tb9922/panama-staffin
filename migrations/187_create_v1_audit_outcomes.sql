-- UP
-- Audit calendar and manual outcome metrics for Panama V1.

CREATE TABLE IF NOT EXISTS audit_tasks (
  id                    BIGSERIAL PRIMARY KEY,
  home_id               INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  template_key          TEXT,
  title                 TEXT NOT NULL,
  category              TEXT NOT NULL DEFAULT 'governance',
  frequency             TEXT NOT NULL DEFAULT 'ad_hoc'
    CHECK (frequency IN ('daily','weekly','monthly','quarterly','annual','ad_hoc')),
  period_start          DATE,
  period_end            DATE,
  due_date              DATE NOT NULL,
  owner_user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','completed','verified','cancelled')),
  evidence_required     BOOLEAN NOT NULL DEFAULT true,
  evidence_notes        TEXT,
  completed_at          TIMESTAMPTZ,
  completed_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  manager_signed_off_at TIMESTAMPTZ,
  manager_signed_off_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  qa_signed_off_at      TIMESTAMPTZ,
  qa_signed_off_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  version               INTEGER NOT NULL DEFAULT 1,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_audit_tasks_home_status
  ON audit_tasks(home_id, status, due_date)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_tasks_template_period
  ON audit_tasks(home_id, template_key, period_start)
  WHERE deleted_at IS NULL AND template_key IS NOT NULL AND period_start IS NOT NULL;

CREATE TABLE IF NOT EXISTS outcome_metrics (
  id            BIGSERIAL PRIMARY KEY,
  home_id       INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  metric_key    TEXT NOT NULL,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  numerator     NUMERIC,
  denominator   NUMERIC,
  notes         TEXT,
  recorded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recorded_at   TIMESTAMPTZ DEFAULT NOW(),
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,
  UNIQUE(home_id, metric_key, period_start)
);

CREATE INDEX IF NOT EXISTS idx_outcome_metrics_home_period
  ON outcome_metrics(home_id, period_start DESC, metric_key)
  WHERE deleted_at IS NULL;

INSERT INTO retention_schedule (
  data_category, retention_period, retention_days, retention_basis,
  legal_basis, applies_to_table, special_category, notes
) VALUES
  (
    'Audit calendar tasks',
    '7 years',
    2555,
    'CQC Reg 17, GDPR Art 5(1)(e)',
    NULL,
    'audit_tasks',
    FALSE,
    'Panama V1 recurring audit evidence and sign-off trail.'
  ),
  (
    'Outcome metrics',
    '7 years',
    2555,
    'CQC Reg 17, GDPR Art 5(1)(e)',
    'May contain special category aggregate health data',
    'outcome_metrics',
    TRUE,
    'Manual aggregate outcome metrics used for governance and CQC evidence.'
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
DROP TABLE IF EXISTS outcome_metrics;
DROP TABLE IF EXISTS audit_tasks;
