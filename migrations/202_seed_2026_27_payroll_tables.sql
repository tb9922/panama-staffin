-- UP
-- 2026/27 statutory payroll seed data.
-- Source: GOV.UK "Rates and thresholds for employers 2026 to 2027", last updated 7 Apr 2026.

INSERT INTO tax_bands (country, tax_year, band_name, lower_limit, upper_limit, rate) VALUES
  ('england_wales', 2026, 'basic',      0,         37700, 0.20),
  ('england_wales', 2026, 'higher',     37700,    125140, 0.40),
  ('england_wales', 2026, 'additional', 125140,     NULL, 0.45),
  ('scotland',      2026, 'starter',        0,      3967, 0.19),
  ('scotland',      2026, 'basic',       3967,     16956, 0.20),
  ('scotland',      2026, 'intermediate',16956,    31092, 0.21),
  ('scotland',      2026, 'higher',      31092,    62430, 0.42),
  ('scotland',      2026, 'advanced',    62430,   125140, 0.45),
  ('scotland',      2026, 'top',        125140,     NULL, 0.48)
ON CONFLICT (country, tax_year, band_name) DO UPDATE SET
  lower_limit = EXCLUDED.lower_limit,
  upper_limit = EXCLUDED.upper_limit,
  rate = EXCLUDED.rate;

INSERT INTO ni_thresholds (tax_year, threshold_name, weekly_amount, monthly_amount, annual_amount) VALUES
  (2026, 'LEL',  129.00,    559.00,   6708.00),
  (2026, 'ST',    96.00,    417.00,   5000.00),
  (2026, 'FUST', 481.00,   2083.00,  25000.00),
  (2026, 'IZUST',481.00,   2083.00,  25000.00),
  (2026, 'PT',   242.00,   1048.00,  12570.00),
  (2026, 'UEL',  967.00,   4189.00,  50270.00),
  (2026, 'UST',  967.00,   4189.00,  50270.00),
  (2026, 'AUST', 967.00,   4189.00,  50270.00),
  (2026, 'VUST', 967.00,   4189.00,  50270.00)
ON CONFLICT (tax_year, threshold_name) DO UPDATE SET
  weekly_amount = EXCLUDED.weekly_amount,
  monthly_amount = EXCLUDED.monthly_amount,
  annual_amount = EXCLUDED.annual_amount;

INSERT INTO ni_rates (tax_year, ni_category, rate_type, rate) VALUES
  (2026, 'A', 'employee_main',      0.08),
  (2026, 'A', 'employee_above_uel', 0.02),
  (2026, 'A', 'employer',           0.15),
  (2026, 'B', 'employee_main',      0.0185),
  (2026, 'B', 'employee_above_uel', 0.02),
  (2026, 'B', 'employer',           0.15),
  (2026, 'C', 'employee_main',      0.00),
  (2026, 'C', 'employee_above_uel', 0.00),
  (2026, 'C', 'employer',           0.15),
  (2026, 'D', 'employee_main',      0.02),
  (2026, 'D', 'employee_above_uel', 0.02),
  (2026, 'D', 'employer_above_fust',0.15),
  (2026, 'E', 'employee_main',      0.0185),
  (2026, 'E', 'employee_above_uel', 0.02),
  (2026, 'E', 'employer_above_fust',0.15),
  (2026, 'F', 'employee_main',      0.08),
  (2026, 'F', 'employee_above_uel', 0.02),
  (2026, 'F', 'employer_above_fust',0.15),
  (2026, 'H', 'employee_main',      0.08),
  (2026, 'H', 'employee_above_uel', 0.02),
  (2026, 'H', 'employer_above_ust', 0.15),
  (2026, 'I', 'employee_main',      0.0185),
  (2026, 'I', 'employee_above_uel', 0.02),
  (2026, 'I', 'employer_above_fust',0.15),
  (2026, 'J', 'employee_main',      0.02),
  (2026, 'J', 'employee_above_uel', 0.02),
  (2026, 'J', 'employer',           0.15),
  (2026, 'K', 'employee_main',      0.00),
  (2026, 'K', 'employee_above_uel', 0.00),
  (2026, 'K', 'employer_above_fust',0.15),
  (2026, 'L', 'employee_main',      0.02),
  (2026, 'L', 'employee_above_uel', 0.02),
  (2026, 'L', 'employer_above_fust',0.15),
  (2026, 'M', 'employee_main',      0.08),
  (2026, 'M', 'employee_above_uel', 0.02),
  (2026, 'M', 'employer_above_ust', 0.15),
  (2026, 'N', 'employee_main',      0.08),
  (2026, 'N', 'employee_above_uel', 0.02),
  (2026, 'N', 'employer_above_fust',0.15),
  (2026, 'S', 'employee_main',      0.00),
  (2026, 'S', 'employee_above_uel', 0.00),
  (2026, 'S', 'employer_above_fust',0.15),
  (2026, 'V', 'employee_main',      0.08),
  (2026, 'V', 'employee_above_uel', 0.02),
  (2026, 'V', 'employer_above_ust', 0.15),
  (2026, 'Z', 'employee_main',      0.02),
  (2026, 'Z', 'employee_above_uel', 0.02),
  (2026, 'Z', 'employer_above_ust', 0.15)
ON CONFLICT (tax_year, ni_category, rate_type) DO UPDATE SET
  rate = EXCLUDED.rate;

INSERT INTO student_loan_thresholds (tax_year, plan, annual_threshold, rate) VALUES
  (2026, '1',  26900, 0.09),
  (2026, '2',  29385, 0.09),
  (2026, '4',  33795, 0.09),
  (2026, '5',  25000, 0.09),
  (2026, 'PG', 21000, 0.06)
ON CONFLICT (tax_year, plan) DO UPDATE SET
  annual_threshold = EXCLUDED.annual_threshold,
  rate = EXCLUDED.rate;

-- DOWN
DELETE FROM student_loan_thresholds WHERE tax_year = 2026;
DELETE FROM ni_rates WHERE tax_year = 2026;
DELETE FROM ni_thresholds WHERE tax_year = 2026;
DELETE FROM tax_bands WHERE tax_year = 2026;
