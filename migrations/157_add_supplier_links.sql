-- UP
ALTER TABLE finance_expenses
  ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id);

ALTER TABLE finance_payment_schedule
  ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id);

CREATE INDEX IF NOT EXISTS idx_finance_expenses_supplier_active
  ON finance_expenses(supplier_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_finance_payment_schedule_supplier_active
  ON finance_payment_schedule(supplier_id)
  WHERE deleted_at IS NULL;

WITH distinct_names AS (
  SELECT DISTINCT home_id, TRIM(supplier) AS supplier_name
    FROM finance_expenses
   WHERE supplier IS NOT NULL
     AND TRIM(supplier) <> ''
     AND deleted_at IS NULL
  UNION
  SELECT DISTINCT home_id, TRIM(supplier) AS supplier_name
    FROM finance_payment_schedule
   WHERE supplier IS NOT NULL
     AND TRIM(supplier) <> ''
     AND deleted_at IS NULL
)
INSERT INTO suppliers (home_id, name)
SELECT home_id, supplier_name
  FROM distinct_names
ON CONFLICT DO NOTHING;

UPDATE finance_expenses fe
   SET supplier_id = s.id
  FROM suppliers s
 WHERE fe.deleted_at IS NULL
   AND fe.supplier_id IS NULL
   AND fe.supplier IS NOT NULL
   AND LOWER(TRIM(fe.supplier)) = LOWER(TRIM(s.name))
   AND s.home_id = fe.home_id
   AND s.deleted_at IS NULL;

UPDATE finance_payment_schedule fps
   SET supplier_id = s.id
  FROM suppliers s
 WHERE fps.deleted_at IS NULL
   AND fps.supplier_id IS NULL
   AND fps.supplier IS NOT NULL
   AND LOWER(TRIM(fps.supplier)) = LOWER(TRIM(s.name))
   AND s.home_id = fps.home_id
   AND s.deleted_at IS NULL;

-- DOWN
DROP INDEX IF EXISTS idx_finance_payment_schedule_supplier_active;
DROP INDEX IF EXISTS idx_finance_expenses_supplier_active;
ALTER TABLE finance_payment_schedule DROP COLUMN IF EXISTS supplier_id;
ALTER TABLE finance_expenses DROP COLUMN IF EXISTS supplier_id;
