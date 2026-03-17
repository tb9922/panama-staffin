-- Fix employer NI Secondary Threshold for 2025-26 tax year.
-- The Autumn Budget 2024 reduced ST from £9,100 to £5,000/year (£96/week, £417/month)
-- effective 6 April 2025, alongside the rate increase from 13.8% to 15%.
-- Source: https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2025-to-2026

UPDATE ni_thresholds
SET weekly_amount  = 96.00,
    monthly_amount = 417.00,
    annual_amount  = 5000.00
WHERE tax_year = 2025
  AND threshold_name = 'ST';
