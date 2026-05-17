-- UP
-- Close HR tenant-integrity and retention-schedule gaps found in the V1 review.

INSERT INTO retention_schedule (data_category, retention_period, retention_days, retention_basis, applies_to_table)
VALUES
  ('HR return to work interviews', '6 years after leaving', 2190, 'Limitation Act 1980 s.5 and employment health evidence retention', 'hr_rtw_interviews'),
  ('HR occupational health referrals', '6 years after leaving', 2190, 'Limitation Act 1980 s.5 and Article 9 employment health evidence retention', 'hr_oh_referrals'),
  ('HR TUPE transfers', '6 years after transfer completion', 2190, 'TUPE Regulations 2006 and Limitation Act 1980 s.5', 'hr_tupe_transfers')
ON CONFLICT (data_category) DO UPDATE SET
  retention_period = EXCLUDED.retention_period,
  retention_days = EXCLUDED.retention_days,
  retention_basis = EXCLUDED.retention_basis,
  applies_to_table = EXCLUDED.applies_to_table;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_grievance_cases_home_id_id_unique') THEN
    ALTER TABLE hr_grievance_cases
      ADD CONSTRAINT hr_grievance_cases_home_id_id_unique UNIQUE (home_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_disciplinary_cases_home_id_id_unique') THEN
    ALTER TABLE hr_disciplinary_cases
      ADD CONSTRAINT hr_disciplinary_cases_home_id_id_unique UNIQUE (home_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_flexible_working_home_id_id_unique') THEN
    ALTER TABLE hr_flexible_working
      ADD CONSTRAINT hr_flexible_working_home_id_id_unique UNIQUE (home_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_contracts_home_id_id_unique') THEN
    ALTER TABLE hr_contracts
      ADD CONSTRAINT hr_contracts_home_id_id_unique UNIQUE (home_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_oh_referrals_home_id_id_unique') THEN
    ALTER TABLE hr_oh_referrals
      ADD CONSTRAINT hr_oh_referrals_home_id_id_unique UNIQUE (home_id, id);
  END IF;
END $$;

ALTER TABLE hr_disciplinary_cases
  DROP CONSTRAINT IF EXISTS hr_disciplinary_cases_linked_grievance_fkey,
  ADD CONSTRAINT hr_disciplinary_cases_linked_grievance_fkey
    FOREIGN KEY (home_id, linked_grievance_id)
    REFERENCES hr_grievance_cases(home_id, id)
    ON DELETE SET NULL (linked_grievance_id)
    NOT VALID;

ALTER TABLE hr_grievance_cases
  DROP CONSTRAINT IF EXISTS hr_grievance_cases_linked_disciplinary_fkey,
  ADD CONSTRAINT hr_grievance_cases_linked_disciplinary_fkey
    FOREIGN KEY (home_id, linked_disciplinary_id)
    REFERENCES hr_disciplinary_cases(home_id, id)
    ON DELETE SET NULL (linked_disciplinary_id)
    NOT VALID;

ALTER TABLE hr_family_leave
  DROP CONSTRAINT IF EXISTS hr_family_leave_flex_working_fkey,
  ADD CONSTRAINT hr_family_leave_flex_working_fkey
    FOREIGN KEY (home_id, flexible_working_request_linked)
    REFERENCES hr_flexible_working(home_id, id)
    ON DELETE SET NULL (flexible_working_request_linked)
    NOT VALID;

ALTER TABLE hr_flexible_working
  DROP CONSTRAINT IF EXISTS hr_flexible_working_contract_fkey,
  ADD CONSTRAINT hr_flexible_working_contract_fkey
    FOREIGN KEY (home_id, contract_variation_id)
    REFERENCES hr_contracts(home_id, id)
    ON DELETE SET NULL (contract_variation_id)
    NOT VALID;

ALTER TABLE hr_edi_records
  DROP CONSTRAINT IF EXISTS hr_edi_records_oh_referral_fkey,
  ADD CONSTRAINT hr_edi_records_oh_referral_fkey
    FOREIGN KEY (home_id, oh_referral_id)
    REFERENCES hr_oh_referrals(home_id, id)
    ON DELETE SET NULL (oh_referral_id)
    NOT VALID;

ALTER TABLE hr_grievance_actions
  DROP CONSTRAINT IF EXISTS hr_grievance_actions_grievance_id_fkey,
  ADD CONSTRAINT hr_grievance_actions_grievance_id_fkey
    FOREIGN KEY (home_id, grievance_id)
    REFERENCES hr_grievance_cases(home_id, id)
    ON DELETE CASCADE
    NOT VALID;

-- DOWN
ALTER TABLE hr_grievance_actions
  DROP CONSTRAINT IF EXISTS hr_grievance_actions_grievance_id_fkey,
  ADD CONSTRAINT hr_grievance_actions_grievance_id_fkey
    FOREIGN KEY (grievance_id) REFERENCES hr_grievance_cases(id) ON DELETE CASCADE;

ALTER TABLE hr_edi_records
  DROP CONSTRAINT IF EXISTS hr_edi_records_oh_referral_fkey,
  ADD CONSTRAINT hr_edi_records_oh_referral_fkey
    FOREIGN KEY (oh_referral_id) REFERENCES hr_oh_referrals(id) ON DELETE SET NULL;

ALTER TABLE hr_flexible_working
  DROP CONSTRAINT IF EXISTS hr_flexible_working_contract_fkey,
  ADD CONSTRAINT hr_flexible_working_contract_fkey
    FOREIGN KEY (contract_variation_id) REFERENCES hr_contracts(id) ON DELETE SET NULL;

ALTER TABLE hr_family_leave
  DROP CONSTRAINT IF EXISTS hr_family_leave_flex_working_fkey,
  ADD CONSTRAINT hr_family_leave_flex_working_fkey
    FOREIGN KEY (flexible_working_request_linked) REFERENCES hr_flexible_working(id) ON DELETE SET NULL;

ALTER TABLE hr_grievance_cases
  DROP CONSTRAINT IF EXISTS hr_grievance_cases_linked_disciplinary_fkey,
  ADD CONSTRAINT hr_grievance_cases_linked_disciplinary_fkey
    FOREIGN KEY (linked_disciplinary_id) REFERENCES hr_disciplinary_cases(id) ON DELETE SET NULL;

ALTER TABLE hr_disciplinary_cases
  DROP CONSTRAINT IF EXISTS hr_disciplinary_cases_linked_grievance_fkey,
  ADD CONSTRAINT hr_disciplinary_cases_linked_grievance_fkey
    FOREIGN KEY (linked_grievance_id) REFERENCES hr_grievance_cases(id) ON DELETE SET NULL;

ALTER TABLE hr_oh_referrals DROP CONSTRAINT IF EXISTS hr_oh_referrals_home_id_id_unique;
ALTER TABLE hr_contracts DROP CONSTRAINT IF EXISTS hr_contracts_home_id_id_unique;
ALTER TABLE hr_flexible_working DROP CONSTRAINT IF EXISTS hr_flexible_working_home_id_id_unique;
ALTER TABLE hr_disciplinary_cases DROP CONSTRAINT IF EXISTS hr_disciplinary_cases_home_id_id_unique;
ALTER TABLE hr_grievance_cases DROP CONSTRAINT IF EXISTS hr_grievance_cases_home_id_id_unique;

DELETE FROM retention_schedule
 WHERE data_category IN ('HR return to work interviews', 'HR occupational health referrals', 'HR TUPE transfers');
