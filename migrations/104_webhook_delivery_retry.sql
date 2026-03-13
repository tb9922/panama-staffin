-- Add retry support to webhook deliveries.
-- status: 'delivered' | 'pending_retry' | 'failed'
-- retry_count + next_retry_at enable exponential backoff.

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS retry_count   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status        VARCHAR(20) NOT NULL DEFAULT 'delivered';

-- Backfill existing rows
UPDATE webhook_deliveries SET status = 'failed' WHERE error IS NOT NULL AND status = 'delivered';

-- Index for the retry poller query
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry
  ON webhook_deliveries(next_retry_at) WHERE status = 'pending_retry';
