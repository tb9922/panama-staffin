-- UP
-- Fix schema seams: missing columns discovered during cross-layer audit.

-- hr_file_attachments: repo queries deleted_at for soft delete but column was never created
ALTER TABLE hr_file_attachments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- hr_contracts: repo update includes 'notes' in settable fields but column missing
ALTER TABLE hr_contracts ADD COLUMN IF NOT EXISTS notes TEXT;

-- hr_edi_records: created_by passed by route factory but column missing (audit trail lost)
ALTER TABLE hr_edi_records ADD COLUMN IF NOT EXISTS created_by TEXT;

-- hr_rtw_dbs_renewals: created_by passed by route factory but column missing (audit trail lost)
ALTER TABLE hr_rtw_dbs_renewals ADD COLUMN IF NOT EXISTS created_by TEXT;

-- DOWN
-- ALTER TABLE hr_file_attachments DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE hr_contracts DROP COLUMN IF EXISTS notes;
-- ALTER TABLE hr_edi_records DROP COLUMN IF EXISTS created_by;
-- ALTER TABLE hr_rtw_dbs_renewals DROP COLUMN IF EXISTS created_by;
