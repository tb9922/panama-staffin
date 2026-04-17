-- UP
CREATE TABLE IF NOT EXISTS document_intake_items (
  id SERIAL PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL CHECK (status IN ('uploaded', 'extracted', 'ready_for_review', 'confirmed', 'failed', 'rejected')),
  source_file_sha256 CHAR(64) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(200) NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  ocr_engine VARCHAR(32) NOT NULL DEFAULT 'paddleocr' CHECK (ocr_engine IN ('paddleocr')),
  classification_target VARCHAR(30) CHECK (classification_target IN ('maintenance', 'finance_ap', 'onboarding', 'cqc')),
  classification_confidence NUMERIC(5,4),
  ocr_extraction_encrypted BYTEA,
  ocr_extraction_iv BYTEA,
  ocr_extraction_tag BYTEA,
  summary_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMPTZ,
  routed_module VARCHAR(50),
  routed_record_id VARCHAR(100),
  routed_attachment_id VARCHAR(100),
  created_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_intake_home_sha_active
  ON document_intake_items(home_id, source_file_sha256)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_document_intake_home_status
  ON document_intake_items(home_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_document_intake_home_target
  ON document_intake_items(home_id, classification_target, created_at DESC)
  WHERE deleted_at IS NULL;

-- DOWN
DROP TABLE IF EXISTS document_intake_items;
