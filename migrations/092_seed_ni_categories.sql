-- Seed NI categories C and H (minimum needed for care home payroll).
-- Category A was seeded in migration 029.

-- Category C: Over state pension age (0% employee, 15% employer)
INSERT INTO ni_rates (tax_year, ni_category, rate_type, rate) VALUES
  (2025, 'C', 'employee_main',      0.0000),
  (2025, 'C', 'employee_above_uel', 0.0000),
  (2025, 'C', 'employer',           0.1500)
ON CONFLICT (tax_year, ni_category, rate_type) DO NOTHING;

-- Category H: Apprentice under 25 (0% employer below UEL, standard employee rates)
-- Note: employer NI is technically 0% only up to Upper Secondary Threshold (£50,270/yr).
-- Above UST the standard 15% applies, but care home apprentices rarely earn above £50k
-- so 0% employer is the pragmatic fix. Document if zero-hours apprentices are hired.
INSERT INTO ni_rates (tax_year, ni_category, rate_type, rate) VALUES
  (2025, 'H', 'employee_main',      0.0800),
  (2025, 'H', 'employee_above_uel', 0.0200),
  (2025, 'H', 'employer',           0.0000)
ON CONFLICT (tax_year, ni_category, rate_type) DO NOTHING;
