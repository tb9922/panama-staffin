/**
 * Integration tests for Finance module (6 sub-resources).
 *
 * Validates: residents (CRUD, fee changes, optimistic locking),
 * invoices (CRUD, lines, invoice number generation),
 * expenses (CRUD, optimistic locking),
 * chase log (create, list),
 * payment schedules (CRUD, optimistic locking),
 * summary queries (income, expenses, ageing).
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as financeRepo from '../../repositories/financeRepo.js';
import * as financeService from '../../services/financeService.js';

let homeA, homeB;

beforeAll(async () => {
  // Clean up previous test data (child tables first due to FK constraints)
  await pool.query(`DELETE FROM finance_invoice_chase WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'fin-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM finance_invoice_lines WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'fin-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM finance_fee_changes WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'fin-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM finance_invoices WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'fin-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM finance_expenses WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'fin-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM finance_payment_schedule WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'fin-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM finance_residents WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'fin-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'fin-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('fin-test-a', 'Finance Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('fin-test-b', 'Finance Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;
});

afterAll(async () => {
  // Clean child tables first
  for (const tbl of [
    'finance_invoice_chase', 'finance_invoice_lines', 'finance_fee_changes',
    'finance_invoices', 'finance_expenses', 'finance_payment_schedule', 'finance_residents',
  ]) {
    await pool.query(`DELETE FROM ${tbl} WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  }
  await pool.query('DELETE FROM beds WHERE home_id IN ($1, $2)', [homeA, homeB]).catch(() => {});
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Residents ────────────────────────────────────────────────────────────────

describe('Finance: residents', () => {
  let residentId;

  it('creates a resident with version=1', async () => {
    const created = await financeRepo.createResident(homeA, {
      resident_name: 'Margaret Smith',
      room_number: '12A',
      admission_date: '2025-06-01',
      care_type: 'residential',
      funding_type: 'self_funded',
      weekly_fee: 1200.50,
      status: 'active',
      created_by: 'admin',
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    residentId = created.id;

    expect(created.resident_name).toBe('Margaret Smith');
    expect(created.room_number).toBe('12A');
    expect(created.admission_date).toBe('2025-06-01');
    expect(created.weekly_fee).toBe(1200.5);
    expect(created.version).toBe(1);
  });

  it('reads by id', async () => {
    const found = await financeRepo.findResidentById(residentId, homeA);
    expect(found).not.toBeNull();
    expect(found.id).toBe(residentId);
    expect(found.resident_name).toBe('Margaret Smith');
  });

  it('blocks cross-home read', async () => {
    const found = await financeRepo.findResidentById(residentId, homeB);
    expect(found).toBeNull();
  });

  it('updates with optimistic locking', async () => {
    const updated = await financeRepo.updateResident(residentId, homeA,
      { weekly_fee: 1350.00 }, null, 1);
    expect(updated).not.toBeNull();
    expect(updated.version).toBe(2);
    expect(updated.weekly_fee).toBe(1350);
  });

  it('returns null on stale version', async () => {
    const result = await financeRepo.updateResident(residentId, homeA,
      { weekly_fee: 9999 }, null, 1);
    expect(result).toBeNull();
  });

  it('counts active residents', async () => {
    const count = await financeRepo.countActiveResidents(homeA);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('updates resident updated_at when recalculating balance and payment info', async () => {
    await pool.query(
      `UPDATE finance_residents SET updated_at = '2000-01-01T00:00:00Z' WHERE id = $1 AND home_id = $2`,
      [residentId, homeA]
    );
    const before = await financeRepo.findResidentById(residentId, homeA);

    const invoice = await financeRepo.createInvoice(homeA, {
      invoice_number: `INV-RBAL-${residentId}`,
      resident_id: residentId,
      payer_type: 'resident',
      payer_name: 'Margaret Smith',
      period_start: '2026-02-01',
      period_end: '2026-02-28',
      subtotal: 1000,
      total_amount: 1000,
      balance_due: 1000,
      status: 'sent',
      issue_date: '2026-02-01',
      due_date: '2026-02-28',
      created_by: 'admin',
    });

    await financeRepo.recalculateResidentBalance(residentId, homeA);
    await financeRepo.updateResidentPaymentInfo(residentId, homeA, '2026-02-15', 250);

    const after = await financeRepo.findResidentById(residentId, homeA);
    expect(after.outstanding_balance).toBe(1000);
    expect(after.last_payment_date).toBe('2026-02-15');
    expect(after.last_payment_amount).toBe(250);
    expect(after.updated_at).not.toBe(before.updated_at);

    await financeRepo.softDelete('invoice', invoice.id, homeA);
  });

  it('findResidents returns { rows, total }', async () => {
    const result = await financeRepo.findResidents(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for other home', async () => {
    const result = await financeRepo.findResidents(homeB);
    expect(result.total).toBe(0);
  });

  it('soft-deletes and excludes from queries', async () => {
    const deleted = await financeRepo.softDelete('resident', residentId, homeA);
    expect(deleted).toBe(true);

    const byId = await financeRepo.findResidentById(residentId, homeA);
    expect(byId).toBeNull();
  });
});

// ── Fee Changes ──────────────────────────────────────────────────────────────

describe('Finance: fee changes', () => {
  let residentId;

  beforeAll(async () => {
    const created = await financeRepo.createResident(homeA, {
      resident_name: 'Fee Test Resident',
      weekly_fee: 1000,
      created_by: 'admin',
    });
    residentId = created.id;
  });

  it('records a fee change', async () => {
    const fc = await financeRepo.createFeeChange(homeA, {
      resident_id: residentId,
      effective_date: '2026-01-15',
      previous_weekly: 1000,
      new_weekly: 1100,
      reason: 'Annual uplift',
      created_by: 'admin',
    });

    expect(fc).not.toBeNull();
    expect(fc.previous_weekly).toBe(1000);
    expect(fc.new_weekly).toBe(1100);
    expect(fc.reason).toBe('Annual uplift');
  });

  it('lists fee changes for resident', async () => {
    const changes = await financeRepo.findFeeChanges(residentId, homeA);
    expect(changes).toHaveLength(1);
    expect(changes[0].effective_date).toBe('2026-01-15');
  });
});

// ── Invoices ─────────────────────────────────────────────────────────────────

describe('Finance: invoices', () => {
  let invoiceId;
  let residentId;

  beforeAll(async () => {
    const created = await financeRepo.createResident(homeA, {
      resident_name: 'Invoice Test Resident',
      weekly_fee: 800,
      created_by: 'admin',
    });
    residentId = created.id;
  });

  it('generates sequential invoice numbers', async () => {
    const num1 = await financeRepo.getNextInvoiceNumber(homeA, 'INV-2601');
    expect(num1).toBe('INV-2601-000001');
  });

  it('creates an invoice with version=1', async () => {
    const created = await financeRepo.createInvoice(homeA, {
      invoice_number: 'INV-2601-001',
      resident_id: residentId,
      payer_type: 'resident',
      payer_name: 'Invoice Test Resident',
      period_start: '2026-01-01',
      period_end: '2026-01-31',
      subtotal: 3200,
      total_amount: 3200,
      balance_due: 3200,
      status: 'draft',
      issue_date: '2026-01-01',
      due_date: '2026-01-31',
      created_by: 'admin',
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    invoiceId = created.id;
    expect(created.invoice_number).toBe('INV-2601-001');
    expect(created.total_amount).toBe(3200);
    expect(created.version).toBe(1);
  });

  it('reads invoice by id', async () => {
    const found = await financeRepo.findInvoiceById(invoiceId, homeA);
    expect(found).not.toBeNull();
    expect(found.payer_name).toBe('Invoice Test Resident');
  });

  it('blocks cross-home invoice read', async () => {
    const found = await financeRepo.findInvoiceById(invoiceId, homeB);
    expect(found).toBeNull();
  });

  it('creates invoice line items', async () => {
    const line = await financeRepo.createInvoiceLine(invoiceId, homeA, {
      description: 'Weekly care fee (4 weeks)',
      quantity: 4,
      unit_price: 800,
      amount: 3200,
      line_type: 'fee',
    });

    expect(line).not.toBeNull();
    expect(line.description).toBe('Weekly care fee (4 weeks)');
    expect(line.quantity).toBe(4);
    expect(line.amount).toBe(3200);
  });

  it('lists invoice lines', async () => {
    const lines = await financeRepo.findInvoiceLines(invoiceId, homeA);
    expect(lines).toHaveLength(1);
    expect(lines[0].line_type).toBe('fee');
  });

  it('updates invoice with optimistic locking', async () => {
    const updated = await financeRepo.updateInvoice(invoiceId, homeA,
      { status: 'sent', amount_paid: 1600, balance_due: 1600 }, null, 1);
    expect(updated).not.toBeNull();
    expect(updated.version).toBe(2);
    expect(updated.status).toBe('sent');
    expect(updated.balance_due).toBe(1600);
  });

  it('returns null on stale invoice version', async () => {
    const result = await financeRepo.updateInvoice(invoiceId, homeA,
      { status: 'paid' }, null, 1);
    expect(result).toBeNull();
  });

  it('findInvoices returns { rows, total }', async () => {
    const result = await financeRepo.findInvoices(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('returns empty invoices for other home', async () => {
    const result = await financeRepo.findInvoices(homeB);
    expect(result.total).toBe(0);
  });

  it('soft-deletes invoice', async () => {
    const deleted = await financeRepo.softDelete('invoice', invoiceId, homeA);
    expect(deleted).toBe(true);

    const byId = await financeRepo.findInvoiceById(invoiceId, homeA);
    expect(byId).toBeNull();
  });
});

// ── Expenses ─────────────────────────────────────────────────────────────────

describe('Finance service hotfixes', () => {
  it('rejects creating an invoice directly as paid', async () => {
    await expect(financeService.createInvoiceWithLines(homeA, {
      payer_type: 'resident',
      payer_name: 'Hotfix Resident',
      status: 'paid',
      lines: [{ description: 'Care fees', quantity: 1, unit_price: 1000, amount: 1000, line_type: 'fee' }],
    }, 'admin')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('voids an unpaid sent invoice', async () => {
    const resident = await financeRepo.createResident(homeA, {
      resident_name: 'Void Test Resident',
      weekly_fee: 1000,
      created_by: 'admin',
    });
    const created = await financeService.createInvoiceWithLines(homeA, {
      resident_id: resident.id,
      payer_type: 'resident',
      payer_name: resident.resident_name,
      status: 'sent',
      lines: [{ description: 'Care fees', quantity: 1, unit_price: 1000, amount: 1000, line_type: 'fee' }],
    }, 'admin');

    const result = await financeService.voidInvoice(created.id, homeA, 'admin');
    expect(result.status).toBe('void');
    expect(result.balance_due).toBe(0);
  });

  it('creates a credit note for an unpaid sent invoice', async () => {
    const resident = await financeRepo.createResident(homeA, {
      resident_name: 'Credit Test Resident',
      weekly_fee: 1000,
      created_by: 'admin',
    });
    const created = await financeService.createInvoiceWithLines(homeA, {
      resident_id: resident.id,
      payer_type: 'resident',
      payer_name: resident.resident_name,
      status: 'sent',
      lines: [{ description: 'Care fees', quantity: 1, unit_price: 850, amount: 850, line_type: 'fee' }],
    }, 'admin');

    const result = await financeService.creditInvoice(created.id, homeA, 'admin');
    expect(result.invoice.status).toBe('credited');
    expect(result.credit_note.status).toBe('credited');
    expect(result.credit_note.total_amount).toBe(-850);
  });

  it('blocks resident deletion while a bed is still occupied', async () => {
    const resident = await financeRepo.createResident(homeA, {
      resident_name: 'Occupied Resident',
      weekly_fee: 900,
      created_by: 'admin',
    });
    await pool.query(
      `INSERT INTO beds (home_id, room_number, status, resident_id, created_by, updated_by)
       VALUES ($1, $2, 'occupied', $3, 'admin', 'admin')`,
      [homeA, `HTFX-${resident.id}`, resident.id]
    );

    await expect(financeService.softDeleteResident(resident.id, homeA, 'admin'))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('Finance: expenses', () => {
  let expenseId;

  it('creates an expense with version=1', async () => {
    const created = await financeRepo.createExpense(homeA, {
      expense_date: '2026-02-01',
      category: 'food',
      description: 'Weekly food delivery — Sysco',
      supplier: 'Sysco UK',
      net_amount: 450.00,
      vat_amount: 90.00,
      gross_amount: 540.00,
      status: 'pending',
      created_by: 'admin',
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    expenseId = created.id;
    expect(created.category).toBe('food');
    expect(created.net_amount).toBe(450);
    expect(created.gross_amount).toBe(540);
    expect(created.version).toBe(1);
  });

  it('reads expense by id', async () => {
    const found = await financeRepo.findExpenseById(expenseId, homeA);
    expect(found).not.toBeNull();
    expect(found.supplier).toBe('Sysco UK');
  });

  it('blocks cross-home expense read', async () => {
    const found = await financeRepo.findExpenseById(expenseId, homeB);
    expect(found).toBeNull();
  });

  it('updates expense with optimistic locking', async () => {
    const updated = await financeRepo.updateExpense(expenseId, homeA,
      { status: 'approved', approved_by: 'manager', approved_date: '2026-02-02' }, null, 1);
    expect(updated).not.toBeNull();
    expect(updated.version).toBe(2);
    expect(updated.status).toBe('approved');
    expect(updated.approved_by).toBe('manager');
  });

  it('returns null on stale expense version', async () => {
    const result = await financeRepo.updateExpense(expenseId, homeA,
      { status: 'paid' }, null, 1);
    expect(result).toBeNull();
  });

  it('findExpenses returns { rows, total }', async () => {
    const result = await financeRepo.findExpenses(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('returns empty expenses for other home', async () => {
    const result = await financeRepo.findExpenses(homeB);
    expect(result.total).toBe(0);
  });

  it('counts pending expenses', async () => {
    // Our expense was approved, so create a pending one
    await financeRepo.createExpense(homeA, {
      expense_date: '2026-02-10',
      category: 'maintenance',
      description: 'Plumbing repair',
      net_amount: 200,
      gross_amount: 240,
      status: 'pending',
      created_by: 'admin',
    });
    const count = await financeRepo.getPendingExpenseCount(homeA);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('soft-deletes expense', async () => {
    const deleted = await financeRepo.softDelete('expense', expenseId, homeA);
    expect(deleted).toBe(true);

    const byId = await financeRepo.findExpenseById(expenseId, homeA);
    expect(byId).toBeNull();
  });
});

// ── Chase Log ────────────────────────────────────────────────────────────────

describe('Finance: chase log', () => {
  let invoiceId;

  beforeAll(async () => {
    const inv = await financeRepo.createInvoice(homeA, {
      invoice_number: 'INV-CHASE-001',
      payer_type: 'la',
      payer_name: 'Local Authority',
      total_amount: 5000,
      balance_due: 5000,
      status: 'sent',
      due_date: '2026-01-15',
      created_by: 'admin',
    });
    invoiceId = inv.id;
  });

  it('creates a chase record', async () => {
    const chase = await financeRepo.createChase(homeA, {
      invoice_id: invoiceId,
      chase_date: '2026-02-01',
      method: 'email',
      contact_name: 'Finance Team',
      outcome: 'Awaiting PO number',
      next_action_date: '2026-02-08',
      created_by: 'admin',
    });

    expect(chase).not.toBeNull();
    expect(chase.method).toBe('email');
    expect(chase.next_action_date).toBe('2026-02-08');
  });

  it('lists chases for invoice', async () => {
    const chases = await financeRepo.findChasesByInvoice(invoiceId, homeA);
    expect(chases).toHaveLength(1);
    expect(chases[0].contact_name).toBe('Finance Team');
  });

  it('finds chases due for action', async () => {
    const due = await financeRepo.getChasesDueForAction(homeA, '2026-02-10');
    expect(due.length).toBeGreaterThanOrEqual(1);
    expect(due[0].invoice_number).toBe('INV-CHASE-001');
  });

  it('returns last chase per invoice', async () => {
    const last = await financeRepo.getLastChasePerInvoice(homeA);
    expect(last.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Payment Schedules ────────────────────────────────────────────────────────

describe('Finance: payment schedules', () => {
  let schedId;

  it('creates a payment schedule with version=1', async () => {
    const created = await financeRepo.createPaymentSchedule(homeA, {
      supplier: 'British Gas',
      category: 'utilities',
      description: 'Monthly gas bill',
      frequency: 'monthly',
      amount: 850.00,
      next_due: '2026-03-01',
      auto_approve: false,
      created_by: 'admin',
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    schedId = created.id;
    expect(created.supplier).toBe('British Gas');
    expect(created.amount).toBe(850);
    expect(created.frequency).toBe('monthly');
    expect(created.version).toBe(1);
  });

  it('reads schedule by id', async () => {
    const found = await financeRepo.findPaymentScheduleById(schedId, homeA);
    expect(found).not.toBeNull();
    expect(found.category).toBe('utilities');
  });

  it('blocks cross-home schedule read', async () => {
    const found = await financeRepo.findPaymentScheduleById(schedId, homeB);
    expect(found).toBeNull();
  });

  it('updates schedule with optimistic locking', async () => {
    const updated = await financeRepo.updatePaymentSchedule(schedId, homeA,
      { amount: 900, on_hold: true, hold_reason: 'Disputing bill' }, null, 1);
    expect(updated).not.toBeNull();
    expect(updated.version).toBe(2);
    expect(updated.amount).toBe(900);
    expect(updated.on_hold).toBe(true);
  });

  it('returns null on stale schedule version', async () => {
    const result = await financeRepo.updatePaymentSchedule(schedId, homeA,
      { amount: 1 }, null, 1);
    expect(result).toBeNull();
  });

  it('findPaymentSchedules returns { rows, total }', async () => {
    const result = await financeRepo.findPaymentSchedules(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('returns empty schedules for other home', async () => {
    const result = await financeRepo.findPaymentSchedules(homeB);
    expect(result.total).toBe(0);
  });

  it('finds upcoming payments', async () => {
    // Un-hold it first so it shows up
    await financeRepo.updatePaymentSchedule(schedId, homeA, { on_hold: false }, null, 2);
    const upcoming = await financeRepo.getUpcomingPayments(homeA, '2026-03-15');
    expect(upcoming.length).toBeGreaterThanOrEqual(1);
  });

  it('soft-deletes schedule', async () => {
    const deleted = await financeService.softDeletePaymentSchedule(schedId, homeA, 'admin');
    expect(deleted).toBe(true);

    const byId = await financeRepo.findPaymentScheduleById(schedId, homeA);
    expect(byId).toBeNull();
  });
});

describe('Finance: scheduled payment processing', () => {
  let schedId;

  beforeAll(async () => {
    const created = await financeRepo.createPaymentSchedule(homeA, {
      supplier: 'Water Board',
      category: 'utilities',
      description: 'Quarterly water',
      frequency: 'monthly',
      amount: 120.25,
      next_due: '2026-04-01',
      auto_approve: true,
      created_by: 'admin',
    });
    schedId = created.id;
  });

  afterAll(async () => {
    if (schedId) {
      await pool.query(`DELETE FROM finance_expenses WHERE home_id = $1 AND schedule_id = $2`, [homeA, schedId]).catch(() => {});
      await pool.query(`DELETE FROM finance_payment_schedule WHERE id = $1 AND home_id = $2`, [schedId, homeA]).catch(() => {});
    }
  });

  it('processes a schedule once and advances next_due', async () => {
    const current = await financeRepo.findPaymentScheduleById(schedId, homeA);
    const result = await financeService.processScheduledPayment(schedId, homeA, 'admin', current.version);

    expect(result.duplicate).not.toBe(true);
    expect(result.expense.schedule_id).toBe(schedId);
    expect(result.expense.scheduled_for_date).toBe('2026-04-01');
    expect(result.expense.status).toBe('approved');
    expect(result.next_due).toBe('2026-05-01');

    const updated = await financeRepo.findPaymentScheduleById(schedId, homeA);
    expect(updated.next_due).toBe('2026-05-01');
    expect(updated.version).toBe(current.version + 1);
  });

  it('rejects stale schedule versions during processing', async () => {
    await expect(
      financeService.processScheduledPayment(schedId, homeA, 'admin', 1)
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('returns the existing scheduled expense instead of duplicating the same due date', async () => {
    const created = await financeRepo.createPaymentSchedule(homeA, {
      supplier: 'Grounds Supplier',
      category: 'maintenance',
      description: 'Gardening',
      frequency: 'monthly',
      amount: 75,
      next_due: '2026-06-01',
      auto_approve: false,
      created_by: 'admin',
    });

    const existingExpense = await financeRepo.createExpense(homeA, {
      expense_date: '2026-06-01',
      category: 'maintenance',
      description: 'Gardening (scheduled)',
      supplier: 'Grounds Supplier',
      net_amount: 75,
      vat_amount: 0,
      gross_amount: 75,
      status: 'pending',
      recurring: true,
      recurrence_frequency: 'monthly',
      schedule_id: created.id,
      scheduled_for_date: '2026-06-01',
      created_by: 'admin',
    });

    const result = await financeService.processScheduledPayment(created.id, homeA, 'admin', created.version);
    expect(result.duplicate).toBe(true);
    expect(result.expense.id).toBe(existingExpense.id);

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM finance_expenses
       WHERE home_id = $1 AND schedule_id = $2 AND scheduled_for_date = $3 AND deleted_at IS NULL`,
      [homeA, created.id, '2026-06-01']
    );
    expect(rows[0].count).toBe(1);

    await pool.query(`DELETE FROM finance_expenses WHERE home_id = $1 AND schedule_id = $2`, [homeA, created.id]);
    await pool.query(`DELETE FROM finance_payment_schedule WHERE id = $1 AND home_id = $2`, [created.id, homeA]);
  });

  it('preserves the original monthly anchor day after a short month', async () => {
    const created = await financeRepo.createPaymentSchedule(homeA, {
      supplier: 'Anchor Supplier',
      category: 'utilities',
      description: 'Month end anchor',
      frequency: 'monthly',
      amount: 99,
      next_due: '2026-01-31',
      auto_approve: false,
      created_by: 'admin',
    });

    const first = await financeRepo.findPaymentScheduleById(created.id, homeA);
    const febRun = await financeService.processScheduledPayment(created.id, homeA, 'admin', first.version);
    expect(febRun.next_due).toBe('2026-02-28');

    const second = await financeRepo.findPaymentScheduleById(created.id, homeA);
    expect(second.anchor_day).toBe(31);
    const marRun = await financeService.processScheduledPayment(created.id, homeA, 'admin', second.version);
    expect(marRun.next_due).toBe('2026-03-31');

    await pool.query(`DELETE FROM finance_expenses WHERE home_id = $1 AND schedule_id = $2`, [homeA, created.id]);
    await pool.query(`DELETE FROM finance_payment_schedule WHERE id = $1 AND home_id = $2`, [created.id, homeA]);
  });
});

// ── Summary Queries ──────────────────────────────────────────────────────────

describe('Finance: summary queries', () => {
  beforeAll(async () => {
    // Create fresh invoice and expense for summary
    await financeRepo.createInvoice(homeA, {
      invoice_number: 'INV-SUM-001',
      payer_type: 'resident',
      payer_name: 'Summary Resident',
      total_amount: 2000,
      amount_paid: 500,
      balance_due: 1500,
      status: 'sent',
      issue_date: '2026-02-01',
      due_date: '2026-02-28',
      created_by: 'admin',
    });
    await financeRepo.createExpense(homeA, {
      expense_date: '2026-02-05',
      category: 'food',
      description: 'Summary test expense',
      net_amount: 300,
      gross_amount: 360,
      status: 'approved',
      created_by: 'admin',
    });
  });

  it('returns income summary for date range', async () => {
    const summary = await financeRepo.getIncomeSummary(homeA, '2026-02-01', '2026-02-28');
    expect(summary.total_invoiced).toBeGreaterThanOrEqual(2000);
    expect(summary.invoice_count).toBeGreaterThanOrEqual(1);
  });

  it('returns expense summary for date range', async () => {
    const summary = await financeRepo.getExpenseSummary(homeA, '2026-02-01', '2026-02-28');
    expect(summary.total_expenses).toBeGreaterThanOrEqual(360);
    expect(summary.expense_count).toBeGreaterThanOrEqual(1);
  });

  it('returns expenses by category', async () => {
    const cats = await financeRepo.getExpensesByCategory(homeA, '2026-01-01', '2026-12-31');
    expect(cats.length).toBeGreaterThanOrEqual(1);
    const food = cats.find(c => c.category === 'food');
    expect(food).toBeDefined();
    expect(food.total).toBeGreaterThan(0);
  });

  it('returns receivables ageing buckets', async () => {
    const ageing = await financeRepo.getReceivablesAgeing(homeA, '2026-04-01');
    expect(ageing).toHaveProperty('buckets');
    expect(ageing).toHaveProperty('total_outstanding');
    expect(ageing.total_outstanding).toBeGreaterThanOrEqual(0);
  });

  it('counts overdue invoices', async () => {
    const count = await financeRepo.getOverdueInvoiceCount(homeA, '2026-04-01');
    expect(typeof count).toBe('number');
  });
});

// ── Invoice cross-home resident validation ────────────────────────────────────

describe('Invoice: cross-home resident validation', () => {
  let invoiceId, residentA, residentB, invoiceVersion;

  beforeAll(async () => {
    // Create a resident in home A
    residentA = await financeRepo.createResident(homeA, {
      resident_name: 'Alice Cross-Home', room_number: '1', status: 'active',
      care_type: 'residential', funding_type: 'self_funded', created_by: 'admin',
    });
    // Create a resident in home B
    residentB = await financeRepo.createResident(homeB, {
      resident_name: 'Bob Other-Home', room_number: '2', status: 'active',
      care_type: 'residential', funding_type: 'self_funded', created_by: 'admin',
    });
    // Create an invoice in home A linked to resident A
    const inv = await financeService.createInvoiceWithLines(homeA, {
      resident_id: residentA.id, payer_type: 'resident', payer_name: 'Alice',
      invoice_date: '2026-03-01', due_date: '2026-03-31', status: 'draft',
      lines: [{ description: 'Weekly fee', unit_price: 1000, quantity: 1, amount: 1000 }],
    }, 'admin');
    invoiceId = inv.id;
    invoiceVersion = inv.version;
  });

  it('rejects update with cross-home resident_id', async () => {
    try {
      await financeService.updateInvoiceWithLines(invoiceId, homeA, {
        resident_id: residentB.id,
      }, 'admin', invoiceVersion);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).toMatch(/not found in this home/i);
      expect(err.statusCode).toBe(400);
    }
  });

  it('allows update with same-home resident_id', async () => {
    const anotherResident = await financeRepo.createResident(homeA, {
      resident_name: 'Carol Same-Home', room_number: '3', status: 'active',
      care_type: 'residential', funding_type: 'self_funded', created_by: 'admin',
    });
    const result = await financeService.updateInvoiceWithLines(invoiceId, homeA, {
      resident_id: anotherResident.id,
    }, 'admin', invoiceVersion);
    expect(result).not.toBeNull();
    expect(result.resident_id).toBe(anotherResident.id);
  });
});
