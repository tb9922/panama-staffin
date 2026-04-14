-- Add optimistic locking to sick periods so concurrent SSP edits do not overwrite each other.

-- UP
ALTER TABLE sick_periods
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- DOWN
ALTER TABLE sick_periods
  DROP COLUMN IF EXISTS version;
