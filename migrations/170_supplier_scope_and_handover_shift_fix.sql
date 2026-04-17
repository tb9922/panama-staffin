-- UP
CREATE OR REPLACE FUNCTION enforce_supplier_home_scope()
RETURNS trigger AS $$
BEGIN
  IF NEW.supplier_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM suppliers s
    WHERE s.id = NEW.supplier_id
      AND s.home_id = NEW.home_id
  ) THEN
    RAISE EXCEPTION 'Supplier % does not belong to home %', NEW.supplier_id, NEW.home_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_finance_expenses_supplier_scope ON finance_expenses;
CREATE TRIGGER trg_finance_expenses_supplier_scope
  BEFORE INSERT OR UPDATE OF supplier_id, home_id
  ON finance_expenses
  FOR EACH ROW
  EXECUTE FUNCTION enforce_supplier_home_scope();

DROP TRIGGER IF EXISTS trg_finance_payment_schedule_supplier_scope ON finance_payment_schedule;
CREATE TRIGGER trg_finance_payment_schedule_supplier_scope
  BEFORE INSERT OR UPDATE OF supplier_id, home_id
  ON finance_payment_schedule
  FOR EACH ROW
  EXECUTE FUNCTION enforce_supplier_home_scope();

ALTER TABLE handover_entries DROP CONSTRAINT IF EXISTS handover_entries_shift_check;
ALTER TABLE handover_entries
  ADD CONSTRAINT handover_entries_shift_check
  CHECK (shift IN ('E', 'L', 'EL', 'N'));

-- DOWN
DROP TRIGGER IF EXISTS trg_finance_expenses_supplier_scope ON finance_expenses;
DROP TRIGGER IF EXISTS trg_finance_payment_schedule_supplier_scope ON finance_payment_schedule;
DROP FUNCTION IF EXISTS enforce_supplier_home_scope();

ALTER TABLE handover_entries DROP CONSTRAINT IF EXISTS handover_entries_shift_check;
ALTER TABLE handover_entries
  ADD CONSTRAINT handover_entries_shift_check
  CHECK (shift IN ('E', 'L', 'N'));
