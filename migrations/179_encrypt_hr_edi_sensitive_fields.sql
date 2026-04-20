-- UP
-- Encrypt high-risk EDI narrative and special-category payloads at rest.
-- Operational metadata stays plaintext for routing/reporting, while
-- free-text/special-category details move into an encrypted JSON blob.

ALTER TABLE hr_edi_records
  ADD COLUMN IF NOT EXISTS sensitive_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS sensitive_iv BYTEA,
  ADD COLUMN IF NOT EXISTS sensitive_tag BYTEA;

-- DOWN
ALTER TABLE hr_edi_records
  DROP COLUMN IF EXISTS sensitive_tag,
  DROP COLUMN IF EXISTS sensitive_iv,
  DROP COLUMN IF EXISTS sensitive_encrypted;
