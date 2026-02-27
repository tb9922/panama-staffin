import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as financeService from '../services/financeService.js';

const router = Router();

// ── Shared Schemas ────────────────────────────────────────────────────────────

const homeIdSchema = z.string().min(1).max(200).optional();
const idSchema = z.coerce.number().int().positive();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

async function resolveHome(req, res) {
  const parsed = homeIdSchema.safeParse(req.query.home);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid home parameter' }); return null; }
  if (!parsed.data) { res.status(400).json({ error: 'home parameter is required' }); return null; }
  const home = await homeRepo.findBySlug(parsed.data);
  if (!home) { res.status(404).json({ error: 'Home not found' }); return null; }
  return home;
}

function handleConstraintError(err, res) {
  if (err.code === '23505') return res.status(409).json({ error: 'Duplicate record — invoice number already exists' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced record not found' });
  if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
  throw err;
}

// ── Resident Schemas ──────────────────────────────────────────────────────────

const residentBodySchema = z.object({
  resident_name: z.string().min(1).max(200),
  room_number: z.string().max(20).optional(),
  admission_date: dateSchema.optional(),
  discharge_date: dateSchema.nullable().optional(),
  care_type: z.enum(['residential', 'nursing', 'dementia_residential', 'dementia_nursing', 'respite']).optional(),
  funding_type: z.enum(['self_funded', 'la_funded', 'chc_funded', 'split_funded', 'respite']).optional(),
  funding_authority: z.string().max(200).nullable().optional(),
  funding_reference: z.string().max(100).nullable().optional(),
  weekly_fee: z.coerce.number().min(0).optional(),
  la_contribution: z.coerce.number().min(0).optional(),
  chc_contribution: z.coerce.number().min(0).optional(),
  fnc_amount: z.coerce.number().min(0).optional(),
  top_up_amount: z.coerce.number().min(0).optional(),
  top_up_payer: z.string().max(200).nullable().optional(),
  top_up_contact: z.string().max(300).nullable().optional(),
  last_fee_review: dateSchema.nullable().optional(),
  next_fee_review: dateSchema.nullable().optional(),
  status: z.enum(['active', 'discharged', 'deceased', 'suspended']).optional(),
  notes: z.string().nullable().optional(),
  _fee_change_reason: z.string().max(500).optional(),
});

const residentUpdateSchema = residentBodySchema.partial();

// ── Invoice Schemas ───────────────────────────────────────────────────────────

const invoiceLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.coerce.number().min(0).default(1),
  unit_price: z.coerce.number(),
  amount: z.coerce.number(),
  line_type: z.enum(['fee', 'top_up', 'fnc', 'additional', 'adjustment', 'credit']).optional(),
});

const invoiceBodySchema = z.object({
  resident_id: z.coerce.number().int().positive().nullable().optional(),
  payer_type: z.enum(['resident', 'la', 'chc', 'family', 'other']),
  payer_name: z.string().min(1).max(200),
  payer_reference: z.string().max(100).nullable().optional(),
  period_start: dateSchema.optional(),
  period_end: dateSchema.optional(),
  adjustments: z.coerce.number().optional(),
  issue_date: dateSchema.nullable().optional(),
  due_date: dateSchema.nullable().optional(),
  status: z.enum(['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'credited']).optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(invoiceLineSchema).optional(),
});

const invoiceUpdateSchema = invoiceBodySchema.partial();

const paymentSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be greater than zero'),
  paid_date: dateSchema.optional(),
  payment_method: z.enum(['bacs', 'cheque', 'card', 'cash', 'direct_debit', 'other']).optional(),
  payment_reference: z.string().max(100).optional(),
});

// ── Expense Schemas ───────────────────────────────────────────────────────────

const expenseBodySchema = z.object({
  expense_date: dateSchema,
  category: z.enum([
    'staffing', 'agency', 'food', 'utilities', 'maintenance', 'medical_supplies',
    'cleaning', 'insurance', 'rent', 'rates', 'training', 'equipment',
    'professional_fees', 'transport', 'laundry', 'other',
  ]),
  subcategory: z.string().max(100).nullable().optional(),
  description: z.string().min(1).max(500),
  supplier: z.string().max(200).nullable().optional(),
  invoice_ref: z.string().max(100).nullable().optional(),
  net_amount: z.coerce.number(),
  vat_amount: z.coerce.number().default(0),
  gross_amount: z.coerce.number(),
  status: z.enum(['pending', 'approved', 'rejected', 'paid', 'void']).optional(),
  paid_date: dateSchema.nullable().optional(),
  payment_method: z.enum(['bacs', 'cheque', 'card', 'cash', 'direct_debit', 'petty_cash', 'other']).nullable().optional(),
  payment_reference: z.string().max(100).nullable().optional(),
  recurring: z.boolean().optional(),
  recurrence_frequency: z.enum(['weekly', 'monthly', 'quarterly', 'annually']).nullable().optional(),
  notes: z.string().nullable().optional(),
});

const expenseUpdateSchema = expenseBodySchema.partial();

// ── Chase Log Schema ─────────────────────────────────────────────────────────

const chaseBodySchema = z.object({
  chase_date: dateSchema,
  method: z.enum(['email', 'phone', 'letter', 'in_person', 'other']),
  contact_name: z.string().max(200).nullable().optional(),
  outcome: z.string().nullable().optional(),
  next_action_date: dateSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});

// ── Payment Schedule Schemas ─────────────────────────────────────────────────

const paymentScheduleBodySchema = z.object({
  supplier: z.string().min(1).max(200),
  category: z.enum([
    'staffing', 'agency', 'food', 'utilities', 'maintenance', 'medical_supplies',
    'cleaning', 'insurance', 'rent', 'rates', 'training', 'equipment',
    'professional_fees', 'transport', 'laundry', 'other',
  ]),
  description: z.string().max(500).nullable().optional(),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'annually']),
  amount: z.coerce.number().positive(),
  next_due: dateSchema,
  auto_approve: z.boolean().optional(),
  on_hold: z.boolean().optional(),
  hold_reason: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const paymentScheduleUpdateSchema = paymentScheduleBodySchema.partial();

// ── Resident Routes ───────────────────────────────────────────────────────────

router.get('/residents', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const pg = paginationSchema.parse(req.query);
    const filters = { limit: pg.limit, offset: pg.offset };
    if (req.query.status) filters.status = req.query.status;
    if (req.query.funding_type) filters.fundingType = req.query.funding_type;
    res.json(await financeService.findResidents(home.id, filters));
  } catch (err) { next(err); }
});

router.post('/residents', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = residentBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    res.status(201).json(await financeService.createResident(home.id, { ...parsed.data, created_by: req.user.username }));
  } catch (err) { next(err); }
});

router.get('/residents/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid resident ID' });
    const result = await financeService.findResidentById(idP.data, home.id);
    if (!result) return res.status(404).json({ error: 'Resident not found' });
    res.json(result);
  } catch (err) { next(err); }
});

router.put('/residents/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid resident ID' });
    const parsed = residentUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await financeService.updateResident(idP.data, home.id, parsed.data, req.user.username);
    if (!result) return res.status(404).json({ error: 'Resident not found' });
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/residents/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid resident ID' });
    const deleted = await financeService.softDeleteResident(idP.data, home.id, req.user.username);
    if (!deleted) return res.status(404).json({ error: 'Resident not found' });
    res.json({ deleted: true });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.get('/residents/:id/fee-history', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid resident ID' });
    res.json(await financeService.findFeeChanges(idP.data, home.id));
  } catch (err) { next(err); }
});

// ── Invoice Routes ────────────────────────────────────────────────────────────

router.get('/invoices', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const pg = paginationSchema.parse(req.query);
    const filters = { limit: pg.limit, offset: pg.offset };
    if (req.query.status) filters.status = req.query.status;
    if (req.query.payer_type) filters.payerType = req.query.payer_type;
    if (req.query.resident_id) filters.residentId = parseInt(req.query.resident_id);
    if (req.query.from) filters.from = req.query.from;
    if (req.query.to) filters.to = req.query.to;
    res.json(await financeService.findInvoices(home.id, filters));
  } catch (err) { next(err); }
});

router.post('/invoices', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = invoiceBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await financeService.createInvoiceWithLines(home.id, parsed.data, req.user.username);
    res.status(201).json(result);
  } catch (err) {
    if (err.code === '23505' || err.code === '23503' || err.statusCode) return handleConstraintError(err, res);
    next(err);
  }
});

router.get('/invoices/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid invoice ID' });
    const result = await financeService.findInvoiceById(idP.data, home.id);
    if (!result) return res.status(404).json({ error: 'Invoice not found' });
    res.json(result);
  } catch (err) { next(err); }
});

router.put('/invoices/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid invoice ID' });
    const parsed = invoiceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await financeService.updateInvoiceWithLines(idP.data, home.id, parsed.data, req.user.username);
    if (!result) return res.status(404).json({ error: 'Invoice not found' });
    res.json(result);
  } catch (err) {
    if (err.code === '23505' || err.code === '23503' || err.statusCode) return handleConstraintError(err, res);
    next(err);
  }
});

router.delete('/invoices/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid invoice ID' });
    const deleted = await financeService.softDeleteInvoice(idP.data, home.id, req.user.username);
    if (!deleted) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ deleted: true });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.post('/invoices/:id/payment', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid invoice ID' });
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await financeService.recordPayment(idP.data, home.id, parsed.data, req.user.username);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

// ── Expense Routes ────────────────────────────────────────────────────────────

router.get('/expenses', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const pg = paginationSchema.parse(req.query);
    const filters = { limit: pg.limit, offset: pg.offset };
    if (req.query.category) filters.category = req.query.category;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.from) filters.from = req.query.from;
    if (req.query.to) filters.to = req.query.to;
    res.json(await financeService.findExpenses(home.id, filters));
  } catch (err) { next(err); }
});

router.post('/expenses', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = expenseBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    res.status(201).json(await financeService.createExpense(home.id, { ...parsed.data, created_by: req.user.username }));
  } catch (err) { next(err); }
});

router.get('/expenses/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid expense ID' });
    const result = await financeService.findExpenseById(idP.data, home.id);
    if (!result) return res.status(404).json({ error: 'Expense not found' });
    res.json(result);
  } catch (err) { next(err); }
});

router.put('/expenses/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid expense ID' });
    const parsed = expenseUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await financeService.updateExpense(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Expense not found' });
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/expenses/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid expense ID' });
    const deleted = await financeService.softDeleteExpense(idP.data, home.id, req.user.username);
    if (!deleted) return res.status(404).json({ error: 'Expense not found' });
    res.json({ deleted: true });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.put('/expenses/:id/approve', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid expense ID' });
    const result = await financeService.approveExpense(idP.data, home.id, req.user.username);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.put('/expenses/:id/reject', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid expense ID' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 1000) : null;
    const result = await financeService.rejectExpense(idP.data, home.id, req.user.username, reason);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

// ── Chase Log ────────────────────────────────────────────────────────────────

router.get('/invoices/:id/chases', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid invoice ID' });
    res.json(await financeService.findChasesByInvoice(idP.data, home.id));
  } catch (err) { next(err); }
});

router.post('/invoices/:id/chases', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid invoice ID' });
    const parsed = chaseBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    res.status(201).json(await financeService.createChase(home.id, { ...parsed.data, invoice_id: idP.data }, req.user.username));
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

// ── Receivables Detail ───────────────────────────────────────────────────────

router.get('/receivables', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    res.json(await financeService.getReceivablesDetail(home.id));
  } catch (err) { next(err); }
});

// ── Payment Schedule ─────────────────────────────────────────────────────────

router.get('/payment-schedules', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const pg = paginationSchema.parse(req.query);
    const filters = { limit: pg.limit, offset: pg.offset };
    if (req.query.on_hold !== undefined) filters.onHold = req.query.on_hold === 'true';
    res.json(await financeService.findPaymentSchedules(home.id, filters));
  } catch (err) { next(err); }
});

router.post('/payment-schedules', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = paymentScheduleBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    res.status(201).json(await financeService.createPaymentSchedule(home.id, parsed.data, req.user.username));
  } catch (err) { next(err); }
});

router.put('/payment-schedules/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid schedule ID' });
    const parsed = paymentScheduleUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await financeService.updatePaymentSchedule(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Payment schedule not found' });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/payment-schedules/:id/process', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid schedule ID' });
    res.json(await financeService.processScheduledPayment(idP.data, home.id, req.user.username));
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.delete('/payment-schedules/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid schedule ID' });
    const deleted = await financeService.softDeletePaymentSchedule(idP.data, home.id, req.user.username);
    if (!deleted) return res.status(404).json({ error: 'Payment schedule not found' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ── Dashboard & Alerts ────────────────────────────────────────────────────────

router.get('/dashboard', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const now = new Date();
    const from = req.query.from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const to = req.query.to || now.toISOString().slice(0, 10);
    if (from > to) return res.status(400).json({ error: '"from" date must not be after "to" date' });
    res.json(await financeService.getFinanceDashboard(home.id, from, to));
  } catch (err) { next(err); }
});

router.get('/alerts', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    res.json(await financeService.getFinanceAlerts(home.id));
  } catch (err) { next(err); }
});

export default router;
