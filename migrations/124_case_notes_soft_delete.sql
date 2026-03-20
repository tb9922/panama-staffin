-- Add soft-delete support to hr_case_notes.
-- Previously, notes could only be hard-deleted via GDPR retention purge.
-- This allows user-initiated soft deletes while preserving the audit trail.
ALTER TABLE hr_case_notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_hr_case_notes_home_case ON hr_case_notes (home_id, case_type, case_id) WHERE deleted_at IS NULL;
