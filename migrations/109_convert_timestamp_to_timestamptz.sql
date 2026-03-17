-- UP
-- Convert all TIMESTAMP (without timezone) columns to TIMESTAMPTZ.
-- Early migrations (001-032, 085, 087) used TIMESTAMP; later migrations correctly
-- use TIMESTAMPTZ. This inconsistency means stored times have no timezone context,
-- which can cause subtle bugs when the server's TZ changes or during BST/GMT transitions.
-- The USING ... AT TIME ZONE 'UTC' clause treats existing values as UTC (which they are,
-- since PostgreSQL NOW() was called in a UTC-configured server).
-- Running ALTER TYPE on a column that is already TIMESTAMPTZ is a no-op.

-- 001: homes
ALTER TABLE homes ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE homes ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- 002: staff
ALTER TABLE staff ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE staff ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE staff ALTER COLUMN deleted_at TYPE TIMESTAMPTZ USING deleted_at AT TIME ZONE 'UTC';

-- 003: shift_overrides
ALTER TABLE shift_overrides ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE shift_overrides ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- 004: training_records
ALTER TABLE training_records ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE training_records ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- 005: supervisions
ALTER TABLE supervisions ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- 006: appraisals
ALTER TABLE appraisals ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- 007: fire_drills
ALTER TABLE fire_drills ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- 008: day_notes
ALTER TABLE day_notes ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- 009: onboarding
ALTER TABLE onboarding ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- 010: incidents
ALTER TABLE incidents ALTER COLUMN cqc_notification_deadline TYPE TIMESTAMPTZ USING cqc_notification_deadline AT TIME ZONE 'UTC';
ALTER TABLE incidents ALTER COLUMN reported_at TYPE TIMESTAMPTZ USING reported_at AT TIME ZONE 'UTC';
ALTER TABLE incidents ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE incidents ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE incidents ALTER COLUMN deleted_at TYPE TIMESTAMPTZ USING deleted_at AT TIME ZONE 'UTC';

-- 011: complaints
ALTER TABLE complaints ALTER COLUMN reported_at TYPE TIMESTAMPTZ USING reported_at AT TIME ZONE 'UTC';
ALTER TABLE complaints ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE complaints ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE complaints ALTER COLUMN deleted_at TYPE TIMESTAMPTZ USING deleted_at AT TIME ZONE 'UTC';

-- 012: complaint_surveys
ALTER TABLE complaint_surveys ALTER COLUMN reported_at TYPE TIMESTAMPTZ USING reported_at AT TIME ZONE 'UTC';
ALTER TABLE complaint_surveys ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- 013: maintenance
ALTER TABLE maintenance ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE maintenance ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE maintenance ALTER COLUMN deleted_at TYPE TIMESTAMPTZ USING deleted_at AT TIME ZONE 'UTC';

-- 014: ipc_audits
ALTER TABLE ipc_audits ALTER COLUMN reported_at TYPE TIMESTAMPTZ USING reported_at AT TIME ZONE 'UTC';
ALTER TABLE ipc_audits ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE ipc_audits ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE ipc_audits ALTER COLUMN deleted_at TYPE TIMESTAMPTZ USING deleted_at AT TIME ZONE 'UTC';

-- 015: risk_register
ALTER TABLE risk_register ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE risk_register ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE risk_register ALTER COLUMN deleted_at TYPE TIMESTAMPTZ USING deleted_at AT TIME ZONE 'UTC';

-- 016: policy_reviews
ALTER TABLE policy_reviews ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE policy_reviews ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE policy_reviews ALTER COLUMN deleted_at TYPE TIMESTAMPTZ USING deleted_at AT TIME ZONE 'UTC';

-- 017: whistleblowing_concerns
ALTER TABLE whistleblowing_concerns ALTER COLUMN reported_at TYPE TIMESTAMPTZ USING reported_at AT TIME ZONE 'UTC';
ALTER TABLE whistleblowing_concerns ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE whistleblowing_concerns ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE whistleblowing_concerns ALTER COLUMN deleted_at TYPE TIMESTAMPTZ USING deleted_at AT TIME ZONE 'UTC';

-- 018: dols + mca_assessments
ALTER TABLE dols ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE dols ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE dols ALTER COLUMN deleted_at TYPE TIMESTAMPTZ USING deleted_at AT TIME ZONE 'UTC';
ALTER TABLE mca_assessments ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE mca_assessments ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE mca_assessments ALTER COLUMN deleted_at TYPE TIMESTAMPTZ USING deleted_at AT TIME ZONE 'UTC';

-- 019: care_certificates
ALTER TABLE care_certificates ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE care_certificates ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- 020: cqc_evidence
ALTER TABLE cqc_evidence ALTER COLUMN added_at TYPE TIMESTAMPTZ USING added_at AT TIME ZONE 'UTC';
ALTER TABLE cqc_evidence ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE cqc_evidence ALTER COLUMN deleted_at TYPE TIMESTAMPTZ USING deleted_at AT TIME ZONE 'UTC';

-- 021: audit_log
ALTER TABLE audit_log ALTER COLUMN ts TYPE TIMESTAMPTZ USING ts AT TIME ZONE 'UTC';

-- 025: pay_rates
ALTER TABLE pay_rates ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE pay_rates ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- 026: timesheets
ALTER TABLE timesheets ALTER COLUMN approved_at TYPE TIMESTAMPTZ USING approved_at AT TIME ZONE 'UTC';
ALTER TABLE timesheets ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE timesheets ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- 027: payroll_runs
ALTER TABLE payroll_runs ALTER COLUMN calculated_at TYPE TIMESTAMPTZ USING calculated_at AT TIME ZONE 'UTC';
ALTER TABLE payroll_runs ALTER COLUMN approved_at TYPE TIMESTAMPTZ USING approved_at AT TIME ZONE 'UTC';
ALTER TABLE payroll_runs ALTER COLUMN exported_at TYPE TIMESTAMPTZ USING exported_at AT TIME ZONE 'UTC';
ALTER TABLE payroll_runs ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE payroll_runs ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- 028: agency_providers + agency_shifts
ALTER TABLE agency_providers ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE agency_shifts ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- 029: tax_codes + payroll_ytd
ALTER TABLE tax_codes ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE tax_codes ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE payroll_ytd ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- 030: pension_enrolments + pension_contributions
ALTER TABLE pension_enrolments ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE pension_contributions ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- 031: sick_periods + enhanced_sick_config
ALTER TABLE sick_periods ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE sick_periods ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
ALTER TABLE enhanced_sick_config ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- 032: hmrc_submissions
ALTER TABLE hmrc_submissions ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE hmrc_submissions ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- 085: complaint_surveys.updated_at
ALTER TABLE complaint_surveys ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- 087: users.locked_until
ALTER TABLE users ALTER COLUMN locked_until TYPE TIMESTAMPTZ USING locked_until AT TIME ZONE 'UTC';

-- DOWN (revert to TIMESTAMP — not recommended)
-- No down migration: reverting TIMESTAMPTZ to TIMESTAMP loses timezone information.
