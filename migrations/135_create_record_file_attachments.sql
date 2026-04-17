CREATE TABLE IF NOT EXISTS record_file_attachments (
  id              SERIAL PRIMARY KEY,
  home_id         INTEGER      NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  module          VARCHAR(30)  NOT NULL CHECK (module IN ('incident', 'complaint', 'ipc_audit', 'maintenance')),
  record_id       VARCHAR(50)  NOT NULL,
  original_name   VARCHAR(500) NOT NULL,
  stored_name     VARCHAR(200) NOT NULL,
  mime_type       VARCHAR(100) NOT NULL,
  size_bytes      INTEGER      NOT NULL CHECK (size_bytes >= 0),
  description     TEXT,
  uploaded_by     VARCHAR(200) NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_record_attach_lookup
  ON record_file_attachments(home_id, module, record_id)
  WHERE deleted_at IS NULL;

INSERT INTO retention_schedule (data_category, retention_period, retention_days, retention_basis, applies_to_table, notes)
VALUES (
  'Operational evidence attachments',
  '10 years',
  3650,
  'CQC Reg 17 - Good governance evidence',
  'record_file_attachments',
  'Incident, complaint, IPC, and maintenance supporting documents'
)
ON CONFLICT (data_category) DO NOTHING;
