-- UP
-- complaint_surveys: add missing updated_at column (repo update sets it but column didn't exist)
ALTER TABLE complaint_surveys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

-- DOWN
ALTER TABLE complaint_surveys DROP COLUMN IF EXISTS updated_at;
