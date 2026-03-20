-- Add a GiST exclusion constraint that prevents overlapping payroll run periods
-- within the same home. The existing UNIQUE(home_id, period_start, period_end)
-- only prevents exact duplicates; it does not block e.g. Jan 1-31 + Jan 15-Feb 15.
-- Application-level checks in payrollService enforce this too, but DB-level is
-- the correct place for a uniqueness invariant.
--
-- Voided runs are excluded so that a run can be voided and a corrected run created
-- for the same (or overlapping) period.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE payroll_runs
  ADD CONSTRAINT payroll_runs_no_overlap
  EXCLUDE USING gist (
    home_id                                     WITH =,
    daterange(period_start, period_end, '[]')   WITH &&
  )
  WHERE (status <> 'voided');
