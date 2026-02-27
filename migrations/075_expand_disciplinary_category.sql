-- UP
-- Expand category CHECK to include capability, attendance, conduct, other.
-- ACAS covers all of these under disciplinary/capability procedures.
ALTER TABLE hr_disciplinary_cases DROP CONSTRAINT IF EXISTS hr_disciplinary_cases_category_check;
ALTER TABLE hr_disciplinary_cases ADD CONSTRAINT hr_disciplinary_cases_category_check
  CHECK (category IN ('misconduct','gross_misconduct','capability','attendance','conduct','other'));

-- DOWN
ALTER TABLE hr_disciplinary_cases DROP CONSTRAINT IF EXISTS hr_disciplinary_cases_category_check;
ALTER TABLE hr_disciplinary_cases ADD CONSTRAINT hr_disciplinary_cases_category_check
  CHECK (category IN ('misconduct','gross_misconduct'));
