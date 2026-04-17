-- 151: Harden handover optimistic locking, scheduled payment idempotency,
-- and staff ID allocation.

-- Handover entries need explicit optimistic locking for update/delete.
ALTER TABLE handover_entries
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Scheduled payments need a durable idempotency key so retries cannot create
-- duplicate or premature expenses for the same schedule occurrence.
ALTER TABLE finance_expenses
  ADD COLUMN IF NOT EXISTS schedule_id INTEGER REFERENCES finance_payment_schedule(id) ON DELETE SET NULL;

ALTER TABLE finance_expenses
  ADD COLUMN IF NOT EXISTS scheduled_for_date DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_expenses_schedule_due_unique
  ON finance_expenses(home_id, schedule_id, scheduled_for_date)
  WHERE schedule_id IS NOT NULL
    AND scheduled_for_date IS NOT NULL
    AND deleted_at IS NULL;

-- Staff IDs are home-scoped strings (S001, S002, ...). Allocate them through a
-- tiny counter table instead of row-locking every staff record in the home.
CREATE TABLE IF NOT EXISTS staff_id_counters (
  home_id INTEGER PRIMARY KEY REFERENCES homes(id) ON DELETE CASCADE,
  next_value INTEGER NOT NULL CHECK (next_value >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO staff_id_counters (home_id, next_value)
SELECT s.home_id,
       COALESCE(MAX(CASE WHEN s.id ~ '^S[0-9]+$' THEN substring(s.id FROM 2)::int ELSE 0 END), 0) + 1
FROM staff s
GROUP BY s.home_id
ON CONFLICT (home_id) DO UPDATE
SET next_value = GREATEST(staff_id_counters.next_value, EXCLUDED.next_value),
    updated_at = NOW();
