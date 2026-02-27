-- UP
-- Enforce that pension rates are stored as decimals (e.g. 0.05 = 5%), not percentages (5).
-- Prevents recurrence of the Phase 2b pension percent/decimal confusion bug.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pension_rates_decimal'
  ) THEN
    ALTER TABLE pension_config
      ADD CONSTRAINT pension_rates_decimal
        CHECK (employee_rate >= 0 AND employee_rate <= 1.0
           AND employer_rate >= 0 AND employer_rate <= 1.0);
  END IF;
END;
$$;

-- DOWN
ALTER TABLE pension_config DROP CONSTRAINT IF EXISTS pension_rates_decimal;
