-- UP
-- updated_at triggers for finance tables (reuses set_updated_at() from migration 056)

DROP TRIGGER IF EXISTS trg_updated_at_finance_residents ON finance_residents;
CREATE TRIGGER trg_updated_at_finance_residents
  BEFORE UPDATE ON finance_residents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_updated_at_finance_invoices ON finance_invoices;
CREATE TRIGGER trg_updated_at_finance_invoices
  BEFORE UPDATE ON finance_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_updated_at_finance_expenses ON finance_expenses;
CREATE TRIGGER trg_updated_at_finance_expenses
  BEFORE UPDATE ON finance_expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
DROP TRIGGER IF EXISTS trg_updated_at_finance_expenses ON finance_expenses;
DROP TRIGGER IF EXISTS trg_updated_at_finance_invoices ON finance_invoices;
DROP TRIGGER IF EXISTS trg_updated_at_finance_residents ON finance_residents;
