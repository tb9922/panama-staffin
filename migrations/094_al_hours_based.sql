-- Migration 094: Convert annual leave from day-counting to hour-counting.
-- UK law: entitlement = 5.6 × contracted weekly hours.
-- al_entitlement becomes OPTIONAL hours override (NULL = auto-derive from formula).
-- al_carryover becomes hours. Existing values × 8 (conservative estimate — managers review).
-- al_hours on shift_overrides stores deduction per AL booking.

-- Step 1: al_entitlement → NUMERIC, set all to NULL.
-- Existing day values are ambiguous (8h day? 12h day?).
-- NULL triggers auto-derive: 5.6 × contract_hours.
-- Staff with enhanced contractual entitlement must be re-entered manually in hours.
ALTER TABLE staff ALTER COLUMN al_entitlement TYPE NUMERIC(6,2) USING NULL;

-- Step 2: al_carryover → NUMERIC, convert days × 8 (approximate).
ALTER TABLE staff ALTER COLUMN al_carryover TYPE NUMERIC(6,2)
  USING COALESCE(al_carryover, 0) * 8.0;
ALTER TABLE staff ALTER COLUMN al_carryover SET DEFAULT 0;

-- Step 3: Add al_hours to shift_overrides.
-- NULL for pre-migration bookings → fallback derives from scheduled shift.
ALTER TABLE shift_overrides ADD COLUMN IF NOT EXISTS al_hours NUMERIC(5,2);

-- Step 4: Partial index for AL-hours-used queries.
CREATE INDEX IF NOT EXISTS idx_overrides_al_staff_date
  ON shift_overrides (home_id, staff_id, date)
  WHERE shift = 'AL';
