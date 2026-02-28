-- UP
-- Pre-deployment hardening: version columns for optimistic locking,
-- soft delete columns for GDPR tables, partial indexes.

-- ── Version columns (optimistic locking) ────────────────────────────────────
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE complaint_surveys ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE dols ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mca_assessments ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE finance_expenses ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE finance_residents ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ipc_audits ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE risk_register ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE policy_reviews ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE whistleblowing_concerns ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cqc_evidence ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE data_breaches ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE consent_records ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE dp_complaints ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE finance_payment_schedule ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- ── GDPR table soft deletes ─────────────────────────────────────────────────
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE data_breaches ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE consent_records ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE dp_complaints ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ── Remaining soft deletes (config/admin + operational tables) ────────────────
ALTER TABLE onboarding ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tax_codes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE training_records ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE handover_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ── Partial indexes on new deleted_at columns ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_data_requests_active ON data_requests (home_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_data_breaches_active ON data_breaches (home_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_consent_records_active ON consent_records (home_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dp_complaints_active ON dp_complaints (home_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_onboarding_active ON onboarding (home_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tax_codes_active ON tax_codes (home_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_training_records_active ON training_records (home_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_handover_entries_active ON handover_entries (home_id) WHERE deleted_at IS NULL;

-- DOWN
-- ALTER TABLE complaints DROP COLUMN IF EXISTS version;
-- ALTER TABLE complaint_surveys DROP COLUMN IF EXISTS version;
-- ALTER TABLE incidents DROP COLUMN IF EXISTS version;
-- ALTER TABLE dols DROP COLUMN IF EXISTS version;
-- ALTER TABLE mca_assessments DROP COLUMN IF EXISTS version;
-- ALTER TABLE finance_invoices DROP COLUMN IF EXISTS version;
-- ALTER TABLE finance_expenses DROP COLUMN IF EXISTS version;
-- ALTER TABLE finance_residents DROP COLUMN IF EXISTS version;
-- ALTER TABLE ipc_audits DROP COLUMN IF EXISTS version;
-- ALTER TABLE maintenance DROP COLUMN IF EXISTS version;
-- ALTER TABLE risk_register DROP COLUMN IF EXISTS version;
-- ALTER TABLE policy_reviews DROP COLUMN IF EXISTS version;
-- ALTER TABLE whistleblowing_concerns DROP COLUMN IF EXISTS version;
-- ALTER TABLE payroll_runs DROP COLUMN IF EXISTS version;
-- ALTER TABLE cqc_evidence DROP COLUMN IF EXISTS version;
-- ALTER TABLE data_breaches DROP COLUMN IF EXISTS version;
-- ALTER TABLE consent_records DROP COLUMN IF EXISTS version;
-- ALTER TABLE dp_complaints DROP COLUMN IF EXISTS version;
-- ALTER TABLE staff DROP COLUMN IF EXISTS version;
-- ALTER TABLE finance_payment_schedule DROP COLUMN IF EXISTS version;
-- DROP INDEX IF EXISTS idx_data_requests_active;
-- DROP INDEX IF EXISTS idx_data_breaches_active;
-- DROP INDEX IF EXISTS idx_consent_records_active;
-- DROP INDEX IF EXISTS idx_dp_complaints_active;
-- DROP INDEX IF EXISTS idx_onboarding_active;
-- DROP INDEX IF EXISTS idx_tax_codes_active;
-- DROP INDEX IF EXISTS idx_training_records_active;
-- DROP INDEX IF EXISTS idx_handover_entries_active;
-- ALTER TABLE data_requests DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE data_breaches DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE consent_records DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE dp_complaints DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE onboarding DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE tax_codes DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE training_records DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE handover_entries DROP COLUMN IF EXISTS deleted_at;
