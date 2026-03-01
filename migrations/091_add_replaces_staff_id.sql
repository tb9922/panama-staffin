-- Track which absent staff member an agency/OT cover is replacing
ALTER TABLE shift_overrides ADD COLUMN IF NOT EXISTS replaces_staff_id TEXT;

CREATE INDEX IF NOT EXISTS idx_shift_overrides_replaces
  ON shift_overrides (home_id, replaces_staff_id)
  WHERE replaces_staff_id IS NOT NULL;
