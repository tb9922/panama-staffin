-- UP
-- Expand case_type CHECK constraint to include all HR case types:
-- rtw_interview, oh_referral, contract, family_leave, flexible_working, edi, tupe, renewal

ALTER TABLE hr_case_notes DROP CONSTRAINT IF EXISTS hr_case_notes_case_type_check;
ALTER TABLE hr_case_notes ADD CONSTRAINT hr_case_notes_case_type_check
  CHECK (case_type IN ('disciplinary','grievance','performance',
    'rtw_interview','oh_referral','contract','family_leave',
    'flexible_working','edi','tupe','renewal'));

-- DOWN
ALTER TABLE hr_case_notes DROP CONSTRAINT IF EXISTS hr_case_notes_case_type_check;
ALTER TABLE hr_case_notes ADD CONSTRAINT hr_case_notes_case_type_check
  CHECK (case_type IN ('disciplinary','grievance','performance'));
