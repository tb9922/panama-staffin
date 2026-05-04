-- UP
-- DB-backed background job queue foundation. Jobs are claimed with row locks;
-- no external broker is required.

CREATE TABLE IF NOT EXISTS job_queue (
  id              BIGSERIAL PRIMARY KEY,
  type            TEXT NOT NULL CHECK (length(trim(type)) > 0),
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','succeeded','failed','dead')),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts    INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  run_after       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at       TIMESTAMPTZ,
  locked_by       TEXT,
  idempotency_key TEXT,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_queue_type_idempotency_key
  ON job_queue(type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_job_queue_claimable
  ON job_queue(run_after, id)
  WHERE status IN ('queued', 'failed');

CREATE INDEX IF NOT EXISTS idx_job_queue_running_lock
  ON job_queue(locked_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_job_queue_status_created
  ON job_queue(status, created_at DESC);

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
  'Background job queue',
  '7 years',
  2555,
  'CQC Reg 17, GDPR Art 5(1)(e)',
  NULL,
  'job_queue',
  FALSE,
  'Operational processing history for V1 automated jobs. Payloads should remain metadata-only and avoid raw resident or staff data.'
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
DROP TABLE IF EXISTS job_queue;
