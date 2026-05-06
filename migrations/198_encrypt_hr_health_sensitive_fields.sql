-- UP
-- Encrypt high-risk RTW and occupational-health medical narratives at rest.

ALTER TABLE hr_rtw_interviews
  ADD COLUMN IF NOT EXISTS sensitive_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS sensitive_iv BYTEA,
  ADD COLUMN IF NOT EXISTS sensitive_tag BYTEA;

ALTER TABLE hr_oh_referrals
  ADD COLUMN IF NOT EXISTS sensitive_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS sensitive_iv BYTEA,
  ADD COLUMN IF NOT EXISTS sensitive_tag BYTEA;

-- DOWN
ALTER TABLE hr_oh_referrals
  DROP COLUMN IF EXISTS sensitive_tag,
  DROP COLUMN IF EXISTS sensitive_iv,
  DROP COLUMN IF EXISTS sensitive_encrypted;

ALTER TABLE hr_rtw_interviews
  DROP COLUMN IF EXISTS sensitive_tag,
  DROP COLUMN IF EXISTS sensitive_iv,
  DROP COLUMN IF EXISTS sensitive_encrypted;
