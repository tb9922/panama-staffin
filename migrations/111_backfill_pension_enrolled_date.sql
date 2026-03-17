-- UP
-- Fix NULL enrolled_date on auto-enrolments caused by property name mismatch
-- (payrollService passed enrolment_date, pensionRepo expected enrolled_date).
-- Backfill from the payroll run's period_end that triggered the auto-enrolment.
UPDATE pension_enrolments pe
SET enrolled_date = (
  SELECT pr.period_end
  FROM payroll_runs pr
  WHERE pr.home_id = pe.home_id
    AND pr.status = 'approved'
  ORDER BY pr.period_end DESC
  LIMIT 1
)
WHERE pe.status = 'eligible_enrolled'
  AND pe.enrolled_date IS NULL;

-- DOWN
-- No rollback needed — backfill is data repair, not schema change
