-- UP
-- hr_contracts: add created_by for audit trail (repo INSERT references it but column missing)
ALTER TABLE hr_contracts ADD COLUMN IF NOT EXISTS created_by TEXT;

-- hr_tupe_transfers: add signed_date (Zod schema accepts it but column missing)
ALTER TABLE hr_tupe_transfers ADD COLUMN IF NOT EXISTS signed_date DATE;

-- DOWN
ALTER TABLE hr_contracts DROP COLUMN IF EXISTS created_by;
ALTER TABLE hr_tupe_transfers DROP COLUMN IF EXISTS signed_date;
