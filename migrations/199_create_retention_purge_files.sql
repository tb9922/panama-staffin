-- UP
-- Durable outbox for regulated file purges. Database rows can be hard-deleted
-- only after a retryable file-delete job has been recorded.

CREATE TABLE IF NOT EXISTS retention_purge_files (
  id             BIGSERIAL PRIMARY KEY,
  home_id        INTEGER REFERENCES homes(id) ON DELETE SET NULL,
  source_module  TEXT NOT NULL,
  source_table   TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  file_path      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'deleted', 'failed')),
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_retention_purge_files_status
  ON retention_purge_files(status, created_at);

CREATE INDEX IF NOT EXISTS idx_retention_purge_files_home
  ON retention_purge_files(home_id, source_module, source_id);

-- DOWN
DROP TABLE IF EXISTS retention_purge_files;
