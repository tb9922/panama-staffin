import { pool } from '../db.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

function d(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : v; }
const ts = toIsoOrNull;
const f = v => v != null ? parseFloat(v) : null;

/* Explicit column lists — no SELECT * — so future columns don't auto-leak to API consumers. */
const RESIDENT_COLS = `id, home_id, resident_name, room_number,
  admission_date, discharge_date, care_type,
  funding_type, funding_authority, funding_reference,
  weekly_fee, la_contribution, chc_contribution, fnc_amount,
  top_up_amount, top_up_payer, top_up_contact,
  last_fee_review, next_fee_review,
  last_payment_date, last_payment_amount, outstanding_balance,
  status, notes, version,
  created_by, created_at, updated_at`;

const INVOICE_COLS = `id, home_id, invoice_number, resident_id,
  payer_type, payer_name, payer_reference,
  period_start, period_end,
  subtotal, adjustments, total_amount, amount_paid, balance_due,
  status, issue_date, due_date, paid_date,
  payment_method, payment_reference,
  notes, version,
  created_by, created_at, updated_at`;

const INVOICE_LINE_COLS = `id, invoice_id, home_id,
  description, quantity, unit_price, amount, line_type,
  created_at`;

const EXPENSE_COLS = `id, home_id,
  expense_date, category, subcategory, description, supplier, supplier_id, invoice_ref,
  net_amount, vat_amount, gross_amount,
  status, approved_by, approved_date,
  rejected_by, rejected_date, rejection_reason,
  paid_date, payment_method, payment_reference,
  recurring, recurrence_frequency,
  notes, schedule_id, scheduled_for_date, version,
  created_by, created_at, updated_at`;

const FEE_CHANGE_COLS = `id, home_id, resident_id,
  effective_date, previous_weekly, new_weekly,
  reason, approved_by, notes,
  created_by, created_at`;

const CHASE_COLS = `id, home_id, invoice_id,
  chase_date, method, contact_name, outcome,
  next_action_date, notes,
  created_by, created_at`;

const SCHEDULE_COLS = `id, home_id,
  supplier, supplier_id, category, description, frequency, amount,
  next_due, anchor_day, auto_approve, on_hold, hold_reason,
  notes, version,
  created_by, created_at, updated_at`;

function getDayOfMonth(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const [, , day] = dateStr.split('-').map(Number);
  return Number.isInteger(day) ? day : null;
}

// ── Finance Residents ─────────────────────────────────────────────────────────

function shapeResident(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id,
    resident_name: row.resident_name, room_number: row.room_number,
    admission_date: d(row.admission_date), discharge_date: d(row.discharge_date),
    care_type: row.care_type, funding_type: row.funding_type,
    funding_authority: row.funding_authority, funding_reference: row.funding_reference,
    weekly_fee: f(row.weekly_fee),
    la_contribution: f(row.la_contribution), chc_contribution: f(row.chc_contribution),
    fnc_amount: f(row.fnc_amount),
    top_up_amount: f(row.top_up_amount), top_up_payer: row.top_up_payer, top_up_contact: row.top_up_contact,
    last_fee_review: d(row.last_fee_review), next_fee_review: d(row.next_fee_review),
    last_payment_date: d(row.last_payment_date), last_payment_amount: f(row.last_payment_amount),
    outstanding_balance: f(row.outstanding_balance),
    status: row.status, notes: row.notes,
    version: row.version,
    created_by: row.created_by, created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findResidents(homeId, { status, fundingType, limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  let sql = `SELECT ${RESIDENT_COLS}, COUNT(*) OVER() AS _total FROM finance_residents WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  if (fundingType) { params.push(fundingType); sql += ` AND funding_type = $${params.length}`; }
  sql += ' ORDER BY room_number ASC, resident_name ASC';
  params.push(Math.min(limit, 500)); sql += ` LIMIT $${params.length}`;
  params.push(offset); sql += ` OFFSET $${params.length}`;
  const { rows } = await conn.query(sql, params);
  const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;
  return { rows: rows.map(shapeResident), total };
}

function shapeResidentWithBed(row) {
  const resident = shapeResident(row);
  if (!resident) return null;
  resident.bed = row.bed_id ? {
    id: row.bed_id,
    room_number: row.bed_room,
    room_type: row.bed_room_type,
    floor: row.bed_floor,
    status: row.bed_status,
  } : null;
  return resident;
}

export async function findResidentsWithBeds(homeId, { status, fundingType, search, limit = 200, offset = 0 } = {}, client) {
  const conn = client || pool;
  const frCols = RESIDENT_COLS.split(',').map(c => `fr.${c.trim()}`).join(', ');
  let sql = `
    SELECT ${frCols}, COUNT(*) OVER() AS _total,
      b.id AS bed_id, b.room_number AS bed_room, b.room_type AS bed_room_type,
      b.floor AS bed_floor, b.status AS bed_status
    FROM finance_residents fr
    LEFT JOIN beds b ON b.resident_id = fr.id AND b.home_id = fr.home_id
      AND b.status IN ('occupied', 'hospital_hold')
    WHERE fr.home_id = $1 AND fr.deleted_at IS NULL`;
  const params = [homeId];
  if (status) { params.push(status); sql += ` AND fr.status = $${params.length}`; }
  if (fundingType) { params.push(fundingType); sql += ` AND fr.funding_type = $${params.length}`; }
  if (search) { params.push(`%${search}%`); sql += ` AND fr.resident_name ILIKE $${params.length}`; }
  sql += ' ORDER BY fr.room_number ASC, fr.resident_name ASC';
  params.push(Math.min(limit, 500)); sql += ` LIMIT $${params.length}`;
  params.push(offset); sql += ` OFFSET $${params.length}`;
  const { rows } = await conn.query(sql, params);
  const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;
  return { rows: rows.map(shapeResidentWithBed), total };
}

export async function findResidentById(id, homeId, client, { forUpdate = false } = {}) {
  const conn = client || pool;
  const sql = `SELECT ${RESIDENT_COLS} FROM finance_residents WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`;
  const { rows } = await conn.query(sql, [id, homeId]);
  return shapeResident(rows[0]);
}

export async function createResident(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO finance_residents
       (home_id, resident_name, room_number, admission_date, discharge_date, care_type,
        funding_type, funding_authority, funding_reference,
        weekly_fee, la_contribution, chc_contribution, fnc_amount,
        top_up_amount, top_up_payer, top_up_contact,
        last_fee_review, next_fee_review, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING ${RESIDENT_COLS}`,
    [homeId, data.resident_name, data.room_number || null,
     data.admission_date || null, data.discharge_date || null,
     data.care_type ?? 'residential',
     data.funding_type ?? 'self_funded', data.funding_authority || null, data.funding_reference || null,
     data.weekly_fee ?? 0, data.la_contribution ?? 0, data.chc_contribution ?? 0, data.fnc_amount ?? 0,
     data.top_up_amount ?? 0, data.top_up_payer || null, data.top_up_contact || null,
     data.last_fee_review || null, data.next_fee_review || null,
     data.status ?? 'active', data.notes || null, data.created_by]
  );
  return shapeResident(rows[0]);
}

export async function updateResident(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'resident_name', 'room_number', 'admission_date', 'discharge_date', 'care_type',
    'funding_type', 'funding_authority', 'funding_reference',
    'weekly_fee', 'la_contribution', 'chc_contribution', 'fnc_amount',
    'top_up_amount', 'top_up_payer', 'top_up_contact',
    'last_fee_review', 'next_fee_review', 'status', 'notes',
  ];
  for (const key of settable) {
    if (key in data) {
      params.push(data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (fields.length === 0) return findResidentById(id, homeId, client);
  fields.push('version = version + 1', 'updated_at = NOW()');
  let sql = `UPDATE finance_residents SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ` RETURNING ${RESIDENT_COLS}`;
  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeResident(rows[0]) : null;
}

export async function countActiveResidents(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    "SELECT COUNT(*)::int AS count FROM finance_residents WHERE home_id = $1 AND status = 'active' AND deleted_at IS NULL",
    [homeId]);
  return rows[0].count;
}

// ── Resident Payment Tracking (system-managed) ──────────────────────────────

const OUTSTANDING_STATUSES = ['sent', 'overdue', 'partially_paid'];

export async function recalculateResidentBalance(residentId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(`
    UPDATE finance_residents SET outstanding_balance = COALESCE((
      SELECT SUM(balance_due) FROM finance_invoices
      WHERE resident_id = $1 AND home_id = $2 AND deleted_at IS NULL
        AND status = ANY($3::text[])
        AND balance_due > 0
    ), 0),
    updated_at = NOW()
    WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL
    RETURNING outstanding_balance
  `, [residentId, homeId, OUTSTANDING_STATUSES]);
  const bal = rows[0]?.outstanding_balance;
  return bal != null ? parseFloat(bal) : 0;
}

export async function updateResidentPaymentInfo(residentId, homeId, paymentDate, paymentAmount, client) {
  const conn = client || pool;
  await conn.query(`
    UPDATE finance_residents SET
      last_payment_date = $3,
      last_payment_amount = $4,
      updated_at = NOW(),
      outstanding_balance = COALESCE((
        SELECT SUM(balance_due) FROM finance_invoices
        WHERE resident_id = $1 AND home_id = $2 AND deleted_at IS NULL
          AND status = ANY($5::text[])
          AND balance_due > 0
      ), 0)
    WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL
  `, [residentId, homeId, paymentDate, paymentAmount, OUTSTANDING_STATUSES]);
}

export async function getResidentsWithOutstandingBalance(homeId, limit = 5) {
  const { rows } = await pool.query(`
    SELECT resident_name, outstanding_balance FROM finance_residents
    WHERE home_id = $1 AND deleted_at IS NULL AND status = 'active'
      AND outstanding_balance > 0
    ORDER BY outstanding_balance DESC LIMIT $2
  `, [homeId, limit]);
  return rows.map(r => ({ ...r, outstanding_balance: f(r.outstanding_balance) }));
}

// ── Fee Changes ───────────────────────────────────────────────────────────────

function shapeFeeChange(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id, resident_id: row.resident_id,
    effective_date: d(row.effective_date),
    previous_weekly: f(row.previous_weekly), new_weekly: f(row.new_weekly),
    reason: row.reason, approved_by: row.approved_by, notes: row.notes,
    created_by: row.created_by, created_at: ts(row.created_at),
  };
}

export async function findFeeChanges(residentId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${FEE_CHANGE_COLS} FROM finance_fee_changes WHERE resident_id = $1 AND home_id = $2 ORDER BY effective_date DESC`,
    [residentId, homeId]);
  return rows.map(shapeFeeChange);
}

export async function createFeeChange(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO finance_fee_changes
       (home_id, resident_id, effective_date, previous_weekly, new_weekly, reason, approved_by, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${FEE_CHANGE_COLS}`,
    [homeId, data.resident_id, data.effective_date,
     data.previous_weekly ?? null, data.new_weekly,
     data.reason || null, data.approved_by || null, data.notes || null, data.created_by]
  );
  return shapeFeeChange(rows[0]);
}

// ── Invoices ──────────────────────────────────────────────────────────────────

function shapeInvoice(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id, invoice_number: row.invoice_number,
    resident_id: row.resident_id,
    payer_type: row.payer_type, payer_name: row.payer_name, payer_reference: row.payer_reference,
    period_start: d(row.period_start), period_end: d(row.period_end),
    subtotal: f(row.subtotal), adjustments: f(row.adjustments),
    total_amount: f(row.total_amount), amount_paid: f(row.amount_paid), balance_due: f(row.balance_due),
    status: row.status, issue_date: d(row.issue_date), due_date: d(row.due_date),
    paid_date: d(row.paid_date), payment_method: row.payment_method, payment_reference: row.payment_reference,
    notes: row.notes,
    version: row.version,
    created_by: row.created_by, created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

function shapeInvoiceLine(row) {
  if (!row) return null;
  return {
    id: row.id, invoice_id: row.invoice_id, home_id: row.home_id,
    description: row.description, quantity: f(row.quantity),
    unit_price: f(row.unit_price), amount: f(row.amount), line_type: row.line_type,
    created_at: ts(row.created_at),
  };
}

export async function findInvoices(homeId, { status, payerType, from, to, residentId, limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  let sql = `SELECT ${INVOICE_COLS}, COUNT(*) OVER() AS _total FROM finance_invoices WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  if (payerType) { params.push(payerType); sql += ` AND payer_type = $${params.length}`; }
  if (residentId) { params.push(residentId); sql += ` AND resident_id = $${params.length}`; }
  if (from) { params.push(from); sql += ` AND COALESCE(issue_date, created_at::date) >= $${params.length}`; }
  if (to) { params.push(to); sql += ` AND COALESCE(issue_date, created_at::date) <= $${params.length}`; }
  sql += ' ORDER BY COALESCE(issue_date, created_at::date) DESC, id DESC';
  params.push(Math.min(limit, 500)); sql += ` LIMIT $${params.length}`;
  params.push(offset); sql += ` OFFSET $${params.length}`;
  const { rows } = await conn.query(sql, params);
  const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;
  return { rows: rows.map(shapeInvoice), total };
}

export async function findInvoiceById(id, homeId, client, { forUpdate } = {}) {
  const conn = client || pool;
  const sql = `SELECT ${INVOICE_COLS} FROM finance_invoices WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`;
  const { rows } = await conn.query(sql, [id, homeId]);
  return shapeInvoice(rows[0]);
}

export async function getNextInvoiceNumber(homeId, prefix, client) {
  const conn = client || pool;
  // Advisory lock serializes invoice number generation per home
  // (FOR UPDATE on LIMIT 1 locks nothing when zero rows match the prefix)
  await conn.query('SELECT pg_advisory_xact_lock($1)', [homeId]);
  const { rows } = await conn.query(
    `SELECT invoice_number FROM finance_invoices
     WHERE home_id = $1 AND invoice_number LIKE $2
     ORDER BY invoice_number DESC LIMIT 1`,
    [homeId, `${prefix}%`]);
  if (rows.length === 0) return `${prefix}-000001`;
  const last = rows[0].invoice_number;
  const seq = parseInt(last.split('-').pop(), 10);
  if (isNaN(seq)) return `${prefix}-000001`;
  return `${prefix}-${String(seq + 1).padStart(6, '0')}`;
}

export async function createInvoice(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO finance_invoices
       (home_id, invoice_number, resident_id, payer_type, payer_name, payer_reference,
        period_start, period_end, subtotal, adjustments, total_amount, amount_paid, balance_due,
        status, issue_date, due_date, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING ${INVOICE_COLS}`,
    [homeId, data.invoice_number, data.resident_id || null,
     data.payer_type, data.payer_name, data.payer_reference || null,
     data.period_start || null, data.period_end || null,
     data.subtotal ?? 0, data.adjustments ?? 0, data.total_amount ?? 0,
     data.amount_paid ?? 0, data.balance_due ?? 0,
     data.status ?? 'draft', data.issue_date || null, data.due_date || null,
     data.notes || null, data.created_by]
  );
  return shapeInvoice(rows[0]);
}

export async function updateInvoice(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'resident_id', 'payer_type', 'payer_name', 'payer_reference',
    'period_start', 'period_end', 'subtotal', 'adjustments', 'total_amount',
    'amount_paid', 'balance_due',
    'status', 'issue_date', 'due_date', 'paid_date',
    'payment_method', 'payment_reference', 'notes',
  ];
  for (const key of settable) {
    if (key in data) {
      params.push(data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (fields.length === 0) return findInvoiceById(id, homeId, client);
  fields.push('version = version + 1', 'updated_at = NOW()');
  let sql = `UPDATE finance_invoices SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ` RETURNING ${INVOICE_COLS}`;
  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeInvoice(rows[0]) : null;
}

// ── Invoice Lines ─────────────────────────────────────────────────────────────

export async function findInvoiceLines(invoiceId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${INVOICE_LINE_COLS} FROM finance_invoice_lines WHERE invoice_id = $1 AND home_id = $2 AND deleted_at IS NULL ORDER BY id`,
    [invoiceId, homeId]);
  return rows.map(shapeInvoiceLine);
}

export async function createInvoiceLine(invoiceId, homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO finance_invoice_lines (invoice_id, home_id, description, quantity, unit_price, amount, line_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${INVOICE_LINE_COLS}`,
    [invoiceId, homeId, data.description, data.quantity ?? 1, data.unit_price, data.amount, data.line_type ?? 'fee']);
  return shapeInvoiceLine(rows[0]);
}

export async function deleteInvoiceLines(invoiceId, homeId, client) {
  const conn = client || pool;
  await conn.query(
    'UPDATE finance_invoice_lines SET deleted_at = NOW() WHERE invoice_id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [invoiceId, homeId]);
}

// ── Expenses ──────────────────────────────────────────────────────────────────

function shapeExpense(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id,
    expense_date: d(row.expense_date), category: row.category, subcategory: row.subcategory,
    description: row.description, supplier: row.supplier, supplier_id: row.supplier_id, invoice_ref: row.invoice_ref,
    net_amount: f(row.net_amount), vat_amount: f(row.vat_amount), gross_amount: f(row.gross_amount),
    status: row.status,
    approved_by: row.approved_by, approved_date: d(row.approved_date),
    rejected_by: row.rejected_by, rejected_date: d(row.rejected_date), rejection_reason: row.rejection_reason,
    paid_date: d(row.paid_date), payment_method: row.payment_method, payment_reference: row.payment_reference,
    recurring: row.recurring, recurrence_frequency: row.recurrence_frequency,
    notes: row.notes,
    schedule_id: row.schedule_id != null ? parseInt(row.schedule_id, 10) : null,
    scheduled_for_date: d(row.scheduled_for_date),
    version: row.version,
    created_by: row.created_by, created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findExpenses(homeId, { category, status, from, to, limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  let sql = `SELECT ${EXPENSE_COLS}, COUNT(*) OVER() AS _total FROM finance_expenses WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (category) { params.push(category); sql += ` AND category = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  if (from) { params.push(from); sql += ` AND expense_date >= $${params.length}`; }
  if (to) { params.push(to); sql += ` AND expense_date <= $${params.length}`; }
  sql += ' ORDER BY expense_date DESC, id DESC';
  params.push(Math.min(limit, 500)); sql += ` LIMIT $${params.length}`;
  params.push(offset); sql += ` OFFSET $${params.length}`;
  const { rows } = await conn.query(sql, params);
  const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;
  return { rows: rows.map(shapeExpense), total };
}

export async function findExpenseById(id, homeId, client, options = {}) {
  const conn = client || pool;
  const forUpdate = options.forUpdate ? ' FOR UPDATE' : '';
  const { rows } = await conn.query(
    `SELECT ${EXPENSE_COLS} FROM finance_expenses WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL${forUpdate}`,
    [id, homeId]);
  return shapeExpense(rows[0]);
}

export async function createExpense(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO finance_expenses
       (home_id, expense_date, category, subcategory, description, supplier, supplier_id, invoice_ref,
        net_amount, vat_amount, gross_amount, status,
        approved_by, approved_date, paid_date, payment_method, payment_reference,
        recurring, recurrence_frequency, notes, schedule_id, scheduled_for_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING ${EXPENSE_COLS}`,
    [homeId, data.expense_date, data.category, data.subcategory || null,
     data.description, data.supplier || null, data.supplier_id || null, data.invoice_ref || null,
     data.net_amount, data.vat_amount ?? 0, data.gross_amount,
     data.status ?? 'pending',
     data.approved_by || null, data.approved_date || null,
     data.paid_date || null, data.payment_method || null, data.payment_reference || null,
     data.recurring ?? false, data.recurrence_frequency || null,
     data.notes || null, data.schedule_id || null, data.scheduled_for_date || null, data.created_by]
  );
  return shapeExpense(rows[0]);
}

export async function findScheduledExpense(homeId, scheduleId, scheduledForDate, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${EXPENSE_COLS}
     FROM finance_expenses
     WHERE home_id = $1
       AND schedule_id = $2
       AND scheduled_for_date = $3
       AND deleted_at IS NULL`,
    [homeId, scheduleId, scheduledForDate]
  );
  return shapeExpense(rows[0]);
}

export async function updateExpense(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'expense_date', 'category', 'subcategory', 'description', 'supplier', 'supplier_id', 'invoice_ref',
    'net_amount', 'vat_amount', 'gross_amount',
    'status', 'approved_by', 'approved_date', 'rejected_by', 'rejected_date', 'rejection_reason',
    'paid_date', 'payment_method', 'payment_reference',
    'recurring', 'recurrence_frequency', 'notes',
  ];
  for (const key of settable) {
    if (key in data) {
      params.push(data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (fields.length === 0) return findExpenseById(id, homeId, client);
  fields.push('version = version + 1', 'updated_at = NOW()');
  let sql = `UPDATE finance_expenses SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ` RETURNING ${EXPENSE_COLS}`;
  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeExpense(rows[0]) : null;
}

// ── Summary Queries ───────────────────────────────────────────────────────────

export async function getIncomeSummary(homeId, from, to, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT
       COALESCE(SUM(total_amount), 0)  AS total_invoiced,
       COALESCE(SUM(amount_paid), 0)   AS total_received,
       COALESCE(SUM(balance_due), 0)   AS total_outstanding,
       COUNT(*)::int                    AS invoice_count
     FROM finance_invoices
     WHERE home_id = $1 AND deleted_at IS NULL
       AND status NOT IN ('void', 'credited')
       AND COALESCE(issue_date, created_at::date) >= $2
       AND COALESCE(issue_date, created_at::date) <= $3`,
    [homeId, from, to]);
  const r = rows[0];
  return { total_invoiced: f(r.total_invoiced), total_received: f(r.total_received), total_outstanding: f(r.total_outstanding), invoice_count: r.invoice_count };
}

export async function getExpenseSummary(homeId, from, to, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT
       COALESCE(SUM(gross_amount), 0) AS total_expenses,
       COUNT(*)::int                   AS expense_count
     FROM finance_expenses
     WHERE home_id = $1 AND deleted_at IS NULL
       AND expense_date >= $2 AND expense_date <= $3
       AND status NOT IN ('void', 'rejected')`,
    [homeId, from, to]);
  const r = rows[0];
  return { total_expenses: f(r.total_expenses), expense_count: r.expense_count };
}

export async function getExpensesByCategory(homeId, from, to, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT category, COALESCE(SUM(gross_amount), 0) AS total, COUNT(*)::int AS count
     FROM finance_expenses
     WHERE home_id = $1 AND deleted_at IS NULL
       AND expense_date >= $2 AND expense_date <= $3
       AND status NOT IN ('void', 'rejected')
     GROUP BY category ORDER BY total DESC`,
    [homeId, from, to]);
  return rows.map(r => ({ category: r.category, total: f(r.total), count: r.count }));
}

export async function getReceivablesAgeing(homeId, asOfDate, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT
       id, invoice_number, payer_type, payer_name, total_amount, amount_paid, balance_due, due_date, status
     FROM finance_invoices
     WHERE home_id = $1 AND deleted_at IS NULL
       AND status NOT IN ('paid','void','credited','draft')
       AND balance_due > 0 AND due_date IS NOT NULL`,
    [homeId]);
  const buckets = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 };
  const items = [];
  const asOf = new Date(asOfDate + 'T00:00:00Z');
  for (const row of rows) {
    const outstanding = f(row.balance_due);
    const due = new Date(row.due_date + 'T00:00:00Z');
    const daysOverdue = Math.floor((asOf - due) / 86400000);
    if (daysOverdue <= 0) buckets.current += outstanding;
    else if (daysOverdue <= 30) buckets.days_1_30 += outstanding;
    else if (daysOverdue <= 60) buckets.days_31_60 += outstanding;
    else if (daysOverdue <= 90) buckets.days_61_90 += outstanding;
    else buckets.days_90_plus += outstanding;
    if (daysOverdue > 0) {
      items.push({
        id: row.id, invoice_number: row.invoice_number,
        payer_type: row.payer_type, payer_name: row.payer_name,
        total_amount: f(row.total_amount), amount_paid: f(row.amount_paid),
        outstanding, due_date: d(row.due_date), days_overdue: daysOverdue,
      });
    }
  }
  items.sort((a, b) => b.days_overdue - a.days_overdue);
  return { buckets, total_outstanding: Object.values(buckets).reduce((s, v) => s + v, 0), overdue_items: items };
}

export async function getOverdueInvoiceCount(homeId, asOfDate, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT COUNT(*)::int AS count FROM finance_invoices
     WHERE home_id = $1 AND deleted_at IS NULL
       AND status NOT IN ('paid','void','credited','draft')
       AND due_date < $2 AND balance_due > 0`,
    [homeId, asOfDate]);
  return rows[0].count;
}

export async function getPendingExpenseCount(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    "SELECT COUNT(*)::int AS count FROM finance_expenses WHERE home_id = $1 AND deleted_at IS NULL AND status = 'pending'",
    [homeId]);
  return rows[0].count;
}

export async function getFeeReviewsDue(homeId, withinDate, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT id, resident_name, room_number, next_fee_review FROM finance_residents
     WHERE home_id = $1 AND deleted_at IS NULL AND status = 'active'
       AND next_fee_review IS NOT NULL AND next_fee_review <= $2
     ORDER BY next_fee_review ASC`,
    [homeId, withinDate]);
  return rows.map(r => ({ id: r.id, resident_name: r.resident_name, room_number: r.room_number, next_fee_review: d(r.next_fee_review) }));
}

// ── Monthly Trend ─────────────────────────────────────────────────────────────

export async function getMonthlyIncomeTrend(homeId, months, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT TO_CHAR(COALESCE(issue_date, created_at::date), 'YYYY-MM') AS month,
            COALESCE(SUM(total_amount), 0) AS invoiced,
            COALESCE(SUM(amount_paid), 0) AS received
     FROM finance_invoices
     WHERE home_id = $1 AND deleted_at IS NULL
       AND status NOT IN ('void', 'credited')
       AND COALESCE(issue_date, created_at::date) >= (CURRENT_DATE - make_interval(months => $2))
     GROUP BY month ORDER BY month`,
    [homeId, months]);
  return rows.map(r => ({ month: r.month, invoiced: f(r.invoiced), received: f(r.received) }));
}

export async function getMonthlyExpenseTrend(homeId, months, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT TO_CHAR(expense_date, 'YYYY-MM') AS month,
            COALESCE(SUM(gross_amount), 0) AS total
     FROM finance_expenses
     WHERE home_id = $1 AND deleted_at IS NULL AND status NOT IN ('void', 'rejected')
       AND expense_date >= (CURRENT_DATE - make_interval(months => $2))
     GROUP BY month ORDER BY month`,
    [homeId, months]);
  return rows.map(r => ({ month: r.month, total: f(r.total) }));
}

// ── Invoice Chase Log ────────────────────────────────────────────────────────

function shapeChase(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id, invoice_id: row.invoice_id,
    chase_date: d(row.chase_date), method: row.method,
    contact_name: row.contact_name, outcome: row.outcome,
    next_action_date: d(row.next_action_date), notes: row.notes,
    created_by: row.created_by, created_at: ts(row.created_at),
  };
}

export async function findChasesByInvoice(invoiceId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${CHASE_COLS} FROM finance_invoice_chase
     WHERE invoice_id = $1 AND home_id = $2 AND deleted_at IS NULL
     ORDER BY chase_date DESC, id DESC`,
    [invoiceId, homeId]);
  return rows.map(shapeChase);
}

export async function createChase(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO finance_invoice_chase
       (home_id, invoice_id, chase_date, method, contact_name, outcome,
        next_action_date, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${CHASE_COLS}`,
    [homeId, data.invoice_id, data.chase_date, data.method,
     data.contact_name || null, data.outcome || null,
     data.next_action_date || null, data.notes || null, data.created_by]);
  return shapeChase(rows[0]);
}

export async function getChasesDueForAction(homeId, beforeDate, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${CHASE_COLS.split(',').map(c => `c.${c.trim()}`).join(', ')},
       i.invoice_number, i.payer_name, i.balance_due
     FROM finance_invoice_chase c
     JOIN finance_invoices i ON i.id = c.invoice_id AND i.deleted_at IS NULL
     WHERE c.home_id = $1 AND c.deleted_at IS NULL
       AND c.next_action_date IS NOT NULL AND c.next_action_date <= $2
       AND i.status NOT IN ('paid','void','credited')
     ORDER BY c.next_action_date ASC`,
    [homeId, beforeDate]);
  return rows.map(r => ({
    ...shapeChase(r),
    invoice_number: r.invoice_number, payer_name: r.payer_name,
    balance_due: f(r.balance_due),
  }));
}

export async function getLastChasePerInvoice(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT DISTINCT ON (invoice_id) ${CHASE_COLS}
     FROM finance_invoice_chase
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY invoice_id, chase_date DESC, id DESC`,
    [homeId]);
  return rows.map(shapeChase);
}

// ── Payment Schedule ─────────────────────────────────────────────────────────

function shapeSchedule(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id,
    supplier: row.supplier, supplier_id: row.supplier_id, category: row.category, description: row.description,
    frequency: row.frequency, amount: f(row.amount),
    next_due: d(row.next_due),
    anchor_day: row.anchor_day != null ? parseInt(row.anchor_day, 10) : null,
    auto_approve: row.auto_approve, on_hold: row.on_hold, hold_reason: row.hold_reason,
    notes: row.notes,
    version: row.version,
    created_by: row.created_by, created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findPaymentSchedules(homeId, { onHold, dueBefore, limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  let sql = `SELECT ${SCHEDULE_COLS}, COUNT(*) OVER() AS _total FROM finance_payment_schedule WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (onHold !== undefined) { params.push(onHold); sql += ` AND on_hold = $${params.length}`; }
  if (dueBefore) { params.push(dueBefore); sql += ` AND next_due <= $${params.length}`; }
  sql += ' ORDER BY next_due ASC, supplier ASC';
  params.push(Math.min(limit, 500)); sql += ` LIMIT $${params.length}`;
  params.push(offset); sql += ` OFFSET $${params.length}`;
  const { rows } = await conn.query(sql, params);
  const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;
  return { rows: rows.map(shapeSchedule), total };
}

export async function findPaymentScheduleById(id, homeId, client, forUpdate = false) {
  const conn = client || pool;
  const sql = `SELECT ${SCHEDULE_COLS} FROM finance_payment_schedule WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`;
  const { rows } = await conn.query(sql, [id, homeId]);
  return shapeSchedule(rows[0]);
}

export async function createPaymentSchedule(homeId, data, client) {
  const conn = client || pool;
  const anchorDay = data.anchor_day ?? getDayOfMonth(data.next_due);
  const { rows } = await conn.query(
    `INSERT INTO finance_payment_schedule
       (home_id, supplier, supplier_id, category, description, frequency, amount, next_due, anchor_day,
        auto_approve, on_hold, hold_reason, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${SCHEDULE_COLS}`,
    [homeId, data.supplier, data.supplier_id || null, data.category, data.description || null,
     data.frequency, data.amount, data.next_due,
     anchorDay,
     data.auto_approve ?? false, data.on_hold ?? false, data.hold_reason || null,
     data.notes || null, data.created_by]);
  return shapeSchedule(rows[0]);
}

export async function updatePaymentSchedule(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = ['supplier', 'supplier_id', 'category', 'description', 'frequency', 'amount', 'next_due', 'anchor_day',
    'auto_approve', 'on_hold', 'hold_reason', 'notes'];
  for (const key of settable) {
    if (key in data) {
      params.push(data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (fields.length === 0) return findPaymentScheduleById(id, homeId, client);
  fields.push('version = version + 1', 'updated_at = NOW()');
  let sql = `UPDATE finance_payment_schedule SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ` RETURNING ${SCHEDULE_COLS}`;
  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeSchedule(rows[0]) : null;
}

export async function getUpcomingPayments(homeId, withinDate, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${SCHEDULE_COLS} FROM finance_payment_schedule
     WHERE home_id = $1 AND deleted_at IS NULL AND on_hold = false AND next_due <= $2
     ORDER BY next_due ASC`,
    [homeId, withinDate]);
  return rows.map(shapeSchedule);
}

// ── Soft Delete ─────────────────────────────────────────────────────────────

const SOFT_DELETE_TABLES = {
  resident: 'finance_residents',
  invoice: 'finance_invoices',
  expense: 'finance_expenses',
  schedule: 'finance_payment_schedule',
};

export async function softDelete(entity, id, homeId, client) {
  const table = SOFT_DELETE_TABLES[entity];
  if (!table) throw new Error(`Unknown entity: ${entity}`);
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE ${table} SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING id`,
    [id, homeId]);
  return rows.length > 0;
}

// ── Dashboard integration queries ───────────────────────────────────────────

export async function getPayrollTotal(homeId, from, to) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(total_gross), 0) AS total
     FROM payroll_runs
     WHERE home_id = $1 AND status IN ('approved','locked','exported')
       AND period_start >= $2 AND period_end <= $3`,
    [homeId, from, to]);
  return rows[0]?.total != null ? parseFloat(rows[0].total) : 0;
}

export async function getAgencyTotal(homeId, from, to) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(total_cost), 0) AS total
     FROM agency_shifts
     WHERE home_id = $1 AND date >= $2 AND date <= $3`,
    [homeId, from, to]);
  return rows[0]?.total != null ? parseFloat(rows[0].total) : 0;
}

export async function getRegisteredBeds(homeId) {
  const { rows } = await pool.query('SELECT config FROM homes WHERE id = $1 AND deleted_at IS NULL', [homeId]);
  return rows[0]?.config?.registered_beds ?? 0;
}
