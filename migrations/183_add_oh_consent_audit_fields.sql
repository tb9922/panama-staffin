-- UP
ALTER TABLE hr_oh_referrals
  ADD COLUMN IF NOT EXISTS consent_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS consent_witness VARCHAR(200);

ALTER TABLE hr_oh_referrals
  DROP CONSTRAINT IF EXISTS hr_oh_referrals_consent_method_check,
  ADD CONSTRAINT hr_oh_referrals_consent_method_check
    CHECK (consent_method IS NULL OR consent_method IN ('written', 'email', 'digital', 'verbal', 'other'));

-- DOWN
ALTER TABLE hr_oh_referrals
  DROP CONSTRAINT IF EXISTS hr_oh_referrals_consent_method_check,
  DROP COLUMN IF EXISTS consent_witness,
  DROP COLUMN IF EXISTS consent_method;
