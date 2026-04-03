CREATE TABLE IF NOT EXISTS training_file_attachments (
  id              SERIAL PRIMARY KEY,
  home_id         INTEGER      NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  staff_id        VARCHAR(20)  NOT NULL,
  training_type   VARCHAR(100) NOT NULL,
  original_name   VARCHAR(500) NOT NULL,
  stored_name     VARCHAR(200) NOT NULL,
  mime_type       VARCHAR(100) NOT NULL,
  size_bytes      INTEGER      NOT NULL CHECK (size_bytes >= 0),
  description     TEXT,
  uploaded_by     VARCHAR(200) NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_training_attach_lookup
  ON training_file_attachments(home_id, staff_id, training_type)
  WHERE deleted_at IS NULL;

INSERT INTO retention_schedule (data_category, retention_period, retention_days, retention_basis, applies_to_table, notes)
VALUES (
  'Training certificates',
  '7 years after leaving',
  2555,
  'CQC Reg 18 - Staffing',
  'training_file_attachments',
  'Certificates, scans, and training evidence uploads'
)
ON CONFLICT (data_category) DO NOTHING;
