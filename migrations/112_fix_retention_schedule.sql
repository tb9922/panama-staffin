-- UP
-- Fix table name mismatches causing silent scan failures
UPDATE retention_schedule SET applies_to_table = 'sick_periods' WHERE applies_to_table = 'ssp_periods';
UPDATE retention_schedule SET applies_to_table = 'training_records' WHERE applies_to_table = 'training';

-- Add missing HR table retention rules (6 years per Limitation Act 1980)
INSERT INTO retention_schedule (data_category, retention_period, retention_days, retention_basis, applies_to_table)
VALUES
  ('HR disciplinary', '6 years after case closure', 2190, 'Limitation Act 1980 s.5 — contract claims', 'hr_disciplinary_cases'),
  ('HR grievance', '6 years after case closure', 2190, 'Limitation Act 1980 s.5 — contract claims', 'hr_grievance_cases'),
  ('HR performance', '6 years after case closure', 2190, 'Limitation Act 1980 s.5 — contract claims', 'hr_performance_cases'),
  ('HR contracts', '6 years after leaving', 2190, 'Limitation Act 1980 s.5 — contract claims', 'hr_contracts'),
  ('HR family leave', '6 years after leave ends', 2190, 'Maternity & Parental Leave Regulations 1999', 'hr_family_leave'),
  ('HR flexible working', '6 years after request', 2190, 'Employment Rights Act 1996 s.80F', 'hr_flexible_working'),
  ('HR EDI records', '6 years after leaving', 2190, 'Equality Act 2010 s.123 — discrimination claims', 'hr_edi_records'),
  ('HR RTW/DBS renewals', '6 years after leaving', 2190, 'Immigration Act 2016 + DBS Code of Practice', 'hr_rtw_dbs_renewals'),
  ('Finance invoices', '6 years after tax year', 2190, 'Companies Act 2006 s.386 / HMRC', 'finance_invoices'),
  ('Finance expenses', '6 years after tax year', 2190, 'Companies Act 2006 s.386 / HMRC', 'finance_expenses')
ON CONFLICT (data_category) DO NOTHING;

-- DOWN
UPDATE retention_schedule SET applies_to_table = 'ssp_periods' WHERE applies_to_table = 'sick_periods' AND data_category LIKE '%health%';
UPDATE retention_schedule SET applies_to_table = 'training' WHERE applies_to_table = 'training_records' AND data_category LIKE '%training%';
DELETE FROM retention_schedule WHERE data_category IN ('HR disciplinary', 'HR grievance', 'HR performance', 'HR contracts', 'HR family leave', 'HR flexible working', 'HR EDI records', 'HR RTW/DBS renewals', 'Finance invoices', 'Finance expenses');
