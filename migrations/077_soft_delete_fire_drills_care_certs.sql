-- Soft-delete support for fire_drills and care_certificates (CQC evidence retention)
ALTER TABLE fire_drills ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE care_certificates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
