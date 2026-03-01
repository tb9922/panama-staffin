-- UP
-- Migration 081 recorded as applied but finance_payment_schedule.version
-- column is missing (table didn't exist when 081 ran).
ALTER TABLE finance_payment_schedule ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- DOWN
-- ALTER TABLE finance_payment_schedule DROP COLUMN IF EXISTS version;
