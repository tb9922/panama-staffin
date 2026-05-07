-- 203_payroll_ni_ssp_hardening.sql
-- Forward hardening for existing deployments:
--   - backfill full 2025/26 NI category support now exposed in payroll UI/API
--   - seed category X for nil NI handling
--   - persist actual SSP qualifying weekdays for non-standard care rotas

-- UP

INSERT INTO ni_thresholds (tax_year, threshold_name, weekly_amount, monthly_amount, annual_amount) VALUES
  (2025, 'LEL',  125.00,    542.00,   6500.00),
  (2025, 'ST',    96.00,    417.00,   5000.00),
  (2025, 'FUST', 481.00,   2083.00,  25000.00),
  (2025, 'IZUST',481.00,   2083.00,  25000.00),
  (2025, 'PT',   242.00,   1048.00,  12570.00),
  (2025, 'UEL',  967.00,   4189.00,  50270.00),
  (2025, 'UST',  967.00,   4189.00,  50270.00),
  (2025, 'AUST', 967.00,   4189.00,  50270.00),
  (2025, 'VUST', 967.00,   4189.00,  50270.00),
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
  (2025, 'A', 'employee_main',       0.08),
  (2025, 'A', 'employee_above_uel',  0.02),
  (2025, 'A', 'employer',            0.15),
  (2025, 'B', 'employee_main',       0.0185),
  (2025, 'B', 'employee_above_uel',  0.02),
  (2025, 'B', 'employer',            0.15),
  (2025, 'C', 'employee_main',       0.00),
  (2025, 'C', 'employee_above_uel',  0.00),
  (2025, 'C', 'employer',            0.15),
  (2025, 'D', 'employee_main',       0.02),
  (2025, 'D', 'employee_above_uel',  0.02),
  (2025, 'D', 'employer_above_fust', 0.15),
  (2025, 'E', 'employee_main',       0.0185),
  (2025, 'E', 'employee_above_uel',  0.02),
  (2025, 'E', 'employer_above_fust', 0.15),
  (2025, 'F', 'employee_main',       0.08),
  (2025, 'F', 'employee_above_uel',  0.02),
  (2025, 'F', 'employer_above_fust', 0.15),
  (2025, 'H', 'employee_main',       0.08),
  (2025, 'H', 'employee_above_uel',  0.02),
  (2025, 'H', 'employer_above_ust',  0.15),
  (2025, 'I', 'employee_main',       0.0185),
  (2025, 'I', 'employee_above_uel',  0.02),
  (2025, 'I', 'employer_above_fust', 0.15),
  (2025, 'J', 'employee_main',       0.02),
  (2025, 'J', 'employee_above_uel',  0.02),
  (2025, 'J', 'employer',            0.15),
  (2025, 'K', 'employee_main',       0.00),
  (2025, 'K', 'employee_above_uel',  0.00),
  (2025, 'K', 'employer_above_fust', 0.15),
  (2025, 'L', 'employee_main',       0.02),
  (2025, 'L', 'employee_above_uel',  0.02),
  (2025, 'L', 'employer_above_fust', 0.15),
  (2025, 'M', 'employee_main',       0.08),
  (2025, 'M', 'employee_above_uel',  0.02),
  (2025, 'M', 'employer_above_ust',  0.15),
  (2025, 'N', 'employee_main',       0.08),
  (2025, 'N', 'employee_above_uel',  0.02),
  (2025, 'N', 'employer_above_fust', 0.15),
  (2025, 'S', 'employee_main',       0.00),
  (2025, 'S', 'employee_above_uel',  0.00),
  (2025, 'S', 'employer_above_fust', 0.15),
  (2025, 'V', 'employee_main',       0.08),
  (2025, 'V', 'employee_above_uel',  0.02),
  (2025, 'V', 'employer_above_ust',  0.15),
  (2025, 'X', 'employee_main',       0.00),
  (2025, 'X', 'employee_above_uel',  0.00),
  (2025, 'X', 'employer',            0.00),
  (2025, 'Z', 'employee_main',       0.02),
  (2025, 'Z', 'employee_above_uel',  0.02),
  (2025, 'Z', 'employer_above_ust',  0.15),
  (2026, 'A', 'employee_main',       0.08),
  (2026, 'A', 'employee_above_uel',  0.02),
  (2026, 'A', 'employer',            0.15),
  (2026, 'B', 'employee_main',       0.0185),
  (2026, 'B', 'employee_above_uel',  0.02),
  (2026, 'B', 'employer',            0.15),
  (2026, 'C', 'employee_main',       0.00),
  (2026, 'C', 'employee_above_uel',  0.00),
  (2026, 'C', 'employer',            0.15),
  (2026, 'D', 'employee_main',       0.02),
  (2026, 'D', 'employee_above_uel',  0.02),
  (2026, 'D', 'employer_above_fust', 0.15),
  (2026, 'E', 'employee_main',       0.0185),
  (2026, 'E', 'employee_above_uel',  0.02),
  (2026, 'E', 'employer_above_fust', 0.15),
  (2026, 'F', 'employee_main',       0.08),
  (2026, 'F', 'employee_above_uel',  0.02),
  (2026, 'F', 'employer_above_fust', 0.15),
  (2026, 'H', 'employee_main',       0.08),
  (2026, 'H', 'employee_above_uel',  0.02),
  (2026, 'H', 'employer_above_ust',  0.15),
  (2026, 'I', 'employee_main',       0.0185),
  (2026, 'I', 'employee_above_uel',  0.02),
  (2026, 'I', 'employer_above_fust', 0.15),
  (2026, 'J', 'employee_main',       0.02),
  (2026, 'J', 'employee_above_uel',  0.02),
  (2026, 'J', 'employer',            0.15),
  (2026, 'K', 'employee_main',       0.00),
  (2026, 'K', 'employee_above_uel',  0.00),
  (2026, 'K', 'employer_above_fust', 0.15),
  (2026, 'L', 'employee_main',       0.02),
  (2026, 'L', 'employee_above_uel',  0.02),
  (2026, 'L', 'employer_above_fust', 0.15),
  (2026, 'M', 'employee_main',       0.08),
  (2026, 'M', 'employee_above_uel',  0.02),
  (2026, 'M', 'employer_above_ust',  0.15),
  (2026, 'N', 'employee_main',       0.08),
  (2026, 'N', 'employee_above_uel',  0.02),
  (2026, 'N', 'employer_above_fust', 0.15),
  (2026, 'S', 'employee_main',       0.00),
  (2026, 'S', 'employee_above_uel',  0.00),
  (2026, 'S', 'employer_above_fust', 0.15),
  (2026, 'V', 'employee_main',       0.08),
  (2026, 'V', 'employee_above_uel',  0.02),
  (2026, 'V', 'employer_above_ust',  0.15),
  (2026, 'X', 'employee_main',       0.00),
  (2026, 'X', 'employee_above_uel',  0.00),
  (2026, 'X', 'employer',            0.00),
  (2026, 'Z', 'employee_main',       0.02),
  (2026, 'Z', 'employee_above_uel',  0.02),
  (2026, 'Z', 'employer_above_ust',  0.15)
ON CONFLICT (tax_year, ni_category, rate_type) DO UPDATE SET
  rate = EXCLUDED.rate;

ALTER TABLE sick_periods
  ADD COLUMN IF NOT EXISTS qualifying_weekdays INTEGER[];

UPDATE sick_periods
   SET qualifying_weekdays = CASE qualifying_days_per_week
     WHEN 1 THEN ARRAY[1]
     WHEN 2 THEN ARRAY[1,2]
     WHEN 3 THEN ARRAY[1,2,3]
     WHEN 4 THEN ARRAY[1,2,3,4]
     WHEN 5 THEN ARRAY[1,2,3,4,5]
     WHEN 6 THEN ARRAY[1,2,3,4,5,6]
     ELSE ARRAY[0,1,2,3,4,5,6]
   END
 WHERE qualifying_weekdays IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sick_periods_qualifying_weekdays_valid'
  ) THEN
    ALTER TABLE sick_periods
      ADD CONSTRAINT sick_periods_qualifying_weekdays_valid
      CHECK (
        qualifying_weekdays IS NULL OR (
          cardinality(qualifying_weekdays) BETWEEN 1 AND 7
          AND qualifying_weekdays <@ ARRAY[0,1,2,3,4,5,6]::integer[]
        )
      );
  END IF;
END $$;

-- DOWN
ALTER TABLE sick_periods
  DROP CONSTRAINT IF EXISTS sick_periods_qualifying_weekdays_valid;
ALTER TABLE sick_periods
  DROP COLUMN IF EXISTS qualifying_weekdays;
