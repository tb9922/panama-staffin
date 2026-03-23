-- Migration 126: Add Student Loan Plan 4 (Scotland) threshold
-- Plan 4 applies to Scottish students who started higher education from September 2012.
-- Threshold: £31,395/year for 2025-26, repayment rate 9%.
-- Without this row, staff with student_loan_plan = '4' would receive zero deduction.

INSERT INTO student_loan_thresholds (tax_year, plan, annual_threshold, rate) VALUES
  (2025, '4', 31395, 0.09)
ON CONFLICT (tax_year, plan) DO NOTHING;

-- Update comment on student_loan_plan column to document Plan 4 as valid
COMMENT ON COLUMN tax_codes.student_loan_plan IS
  'Student Loan repayment plan: 1 | 2 | 4 (Scotland) | PG (postgraduate). NULL = no plan.';
