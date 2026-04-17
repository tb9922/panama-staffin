ALTER TABLE finance_payment_schedule
  ADD COLUMN IF NOT EXISTS anchor_day INTEGER;

UPDATE finance_payment_schedule
   SET anchor_day = EXTRACT(DAY FROM next_due)::INTEGER
 WHERE anchor_day IS NULL;

ALTER TABLE finance_payment_schedule
  ALTER COLUMN anchor_day SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'finance_payment_schedule_anchor_day_check'
  ) THEN
    ALTER TABLE finance_payment_schedule
      ADD CONSTRAINT finance_payment_schedule_anchor_day_check
      CHECK (anchor_day BETWEEN 1 AND 31);
  END IF;
END $$;
