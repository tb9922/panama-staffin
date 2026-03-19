-- UP
-- Add soft-delete support to hr_investigation_meetings.
-- Meeting records contain investigation summaries and attendee names (GDPR special category
-- employment data). Soft-delete allows erroneous records to be removed while preserving
-- the CQC audit trail; hard-deletes still happen at case expiry via GDPR purge.

ALTER TABLE hr_investigation_meetings
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- DOWN
ALTER TABLE hr_investigation_meetings DROP COLUMN IF EXISTS deleted_at;
