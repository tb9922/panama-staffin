-- Add locked_at to webhook_deliveries to track when a delivery was claimed for
-- in-progress processing. Used by rescueStuckInProgress() to detect and reset
-- rows where the process crashed during the HTTP fetch (avoiding permanent stall).
-- Also add 'in_progress' to the status check constraint and index the column.

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- Index to efficiently find stuck in_progress rows during rescue sweep
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_locked
  ON webhook_deliveries(locked_at) WHERE status = 'in_progress';
