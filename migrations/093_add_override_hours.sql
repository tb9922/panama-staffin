-- Add override_hours for TRN/ADM on off-days (actual training/admin hours attended).
-- NULL when shift replaces a working day (pay = full scheduled shift hours).
ALTER TABLE shift_overrides ADD COLUMN IF NOT EXISTS override_hours NUMERIC(4,1);
