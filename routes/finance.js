import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import * as financeService from '../services/financeService.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';

const router = Router();

// ── Shared Schemas ────────────────────────────────────────────────────────────

const idSchema = z.coerce.number().int().positive();
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const safeStr = (v, max = 50) => typeof v === 'string' ? v.slice(0, max) : undefined;
const safeDate = v => (typeof v === 'string' && dateRe.test(v)) ? v : undefined;
const safeInt = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : undefined; };

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

const residentUpdateSchema = residentBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

// ── Invoice Schemas ───────────────────────────────────────────────────────────

const invoiceLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.coerce.number().min(0).default(1),
  unit_price: z.coerce.number().min(0),
  amount: z.coerce.number().min(0),
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

const invoiceUpdateSchema = invoiceBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

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
  net_amount: z.coerce.number().min(0),
  vat_amount: z.coerce.number().min(0).default(0),
  gross_amount: z.coerce.number().min(0),
  status: z.enum(['pending', 'approved', 'rejected', 'paid', 'void']).optional(),
  paid_date: dateSchema.nullable().optional(),
  payment_method: z.enum(['bacs', 'cheque', 'card', 'cash', 'direct_debit', 'petty_cash', 'other']).nullable().optional(),
  payment_reference: z.string().max(100).nullable().optional(),
  recurring: z.boolean().optional(),
  recurrence_frequency: z.enum(['weekly', 'monthly', 'quarterly', 'annually']).nullable().optional(),
  notes: z.string().nullable().optional(),
});

const expenseUpdateSchema = expenseBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

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

const paymentScheduleUpdateSchema = paymentScheduleBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

// ── Resident Routes ───────────────────────────────────────────────────────────

// Residents with bed assignments — used by standalone Residents page
router.get('/residents/with-beds', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const filters = {};
    if (req.query.status) filters.status = safeStr(req.query.status);
    if (req.query.funding_type) filters.fundingType = safeStr(req.query.funding_type);
    if (req.query.search) filters.search = safeStr(req.query.search, 200);
    const result = await financeService.findResidentsWithBeds(req.home.id, filters);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/residents', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const filters = { limit: pg.limit, offset: pg.offset };
    if (req.query.status) filters.status = safeStr(req.query.status);
    if (req.query.funding_type) filters.fundingType = safeStr(req.query.funding_type);
    res.json(await financeService.findResidents(req.home.id, filters));
  } catch (err) { next(err); }
});

router.post('/residents', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = residentBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await financeService.createResident(req.home.id, { ...parsed.data, created_by: req.user.username });
    await auditService.log('finance_create', req.home.slug, req.user.username, { id: result.id, entity: 'resident' });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.get('/residents/:id', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid resident ID' });
    const result = await financeService.findResidentById(idP.data, req.home.id);
    if (!result) return res.status(404).json({ error: 'Resident not found' });
    res.json(result);
  } catch (err) { next(err); }
});

router.put('/residents/:id', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid resident ID' });
    const parsed = residentUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const existing = await financeService.findResidentById(idP.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Resident not found' });
    const version = parsed.data._version != null ? parsed.data._version : null;
    const result = await financeService.updateResident(idP.data, req.home.id, parsed.data, req.user.username, version);
    if (result === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    await auditService.log('finance_update', req.home.slug, req.user.username, { id: idP.data, entity: 'resident', changes: diffFields(existing, result) });
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/residents/:id', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid resident ID' });
    const deleted = await financeService.softDeleteResident(idP.data, req.home.id, req.user.username);
    if (!deleted) return res.status(404).json({ error: 'Resident not found' });
    await auditService.log('finance_delete', req.home.slug, req.user.username, { id: idP.data, entity: 'resident' });
    res.json({ deleted: true });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.get('/residents/:id/fee-history', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid resident ID' });
    res.json(await financeService.findFeeChanges(idP.data, req.home.id));
  } catch (err) { next(err); }
});

// ── Invoice Routes ────────────────────────────────────────────────────────────

router.get('/invoices', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const filters = { limit: pg.limit, offset: pg.offset };
    if (req.query.status) filters.status = safeStr(req.query.status);
    if (req.query.payer_type) filters.payerType = safeStr(req.query.payer_type);
    if (req.query.resident_id) { const rid = safeInt(req.query.resident_id); if (rid) filters.residentId = rid; }
    if (req.query.from) { const d = safeDate(req.query.from); if (d) filters.from = d; }
    if (req.query.to) { const d = safeDate(req.query.to); if (d) filters.to = d; }
    res.json(await financeService.findInvoices(req.home.id, filters));
  } catch (err) { next(err); }
});

router.post('/invoices', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = invoiceBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await financeService.createInvoiceWithLines(req.home.id, parsed.data, req.user.username);
    await auditService.log('finance_create', req.home.slug, req.user.username, { id: result.id, entity: 'invoice' });
    res.status(201).json(result);
  } catch (err) {
    if (err.code === '23505' || err.code === '23503' || err.statusCode) return handleConstraintError(err, res);
    next(err);
  }
});

router.get('/invoices/:id', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid invoice ID' });
    const result = await financeService.findInvoiceById(idP.data, req.home.id);
    if (!result) return res.status(404).json({ error: 'Invoice not found' });
    res.json(result);
  } catch (err) { next(err); }
});

router.put('/invoices/:id', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid invoice ID' });
    const parsed = invoiceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const existing = await financeService.findInvoiceById(idP.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    const version = parsed.data._version != null ? parsed.data._version : null;
    const result = await financeService.updateInvoiceWithLines(idP.data, req.home.id, parsed.data, req.user.username, version);
    if (result === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    await auditService.log('finance_update', req.home.slug, req.user.username, { id: idP.data, entity: 'invoice', changes: diffFields(existing, result) });
    res.json(result);
  } catch (err) {
    if (err.code === '23505' || err.code === '23503' || err.statusCode) return handleConstraintError(err, res);
    next(err);
  }
});

router.delete('/invoices/:id', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid invoice ID' });
    const deleted = await financeService.softDeleteInvoice(idP.data, req.home.id, req.user.username);
    if (!deleted) return res.status(404).json({ error: 'Invoice not found' });
    await auditService.log('finance_delete', req.home.slug, req.user.username, { id: idP.data, entity: 'invoice' });
    res.json({ deleted: true });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.post('/invoices/:id/payment', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid invoice ID' });
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await financeService.recordPayment(idP.data, req.home.id, parsed.data, req.user.username);
    await auditService.log('finance_create', req.home.slug, req.user.username, { id: idP.data, entity: 'payment', amount: parsed.data.amount });
    res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

// ── Expense Routes ────────────────────────────────────────────────────────────

router.get('/expenses', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const filters = { limit: pg.limit, offset: pg.offset };
    if (req.query.category) filters.category = safeStr(req.query.category);
    if (req.query.status) filters.status = safeStr(req.query.status);
    if (req.query.from) { const d = safeDate(req.query.from); if (d) filters.from = d; }
    if (req.query.to) { const d = safeDate(req.query.to); if (d) filters.to = d; }
    res.json(await financeService.findExpenses(req.home.id, filters));
  } catch (err) { next(err); }
});

router.post('/expenses', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = expenseBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await financeService.createExpense(req.home.id, { ...parsed.data, created_by: req.user.username });
    await auditService.log('finance_create', req.home.slug, req.user.username, { id: result.id, entity: 'expense' });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.get('/expenses/:id', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid expense ID' });
    const result = await financeService.findExpenseById(idP.data, req.home.id);
    if (!result) return res.status(404).json({ error: 'Expense not found' });
    res.json(result);
  } catch (err) { next(err); }
});

router.put('/expenses/:id', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid expense ID' });
    const parsed = expenseUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const existing = await financeService.findExpenseById(idP.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Expense not found' });
    const version = parsed.data._version != null ? parsed.data._version : null;
    const result = await financeService.updateExpense(idP.data, req.home.id, parsed.data, version);
    if (result === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    await auditService.log('finance_update', req.home.slug, req.user.username, { id: idP.data, entity: 'expense', changes: diffFields(existing, result) });
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/expenses/:id', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid expense ID' });
    const deleted = await financeService.softDeleteExpense(idP.data, req.home.id, req.user.username);
    if (!deleted) return res.status(404).json({ error: 'Expense not found' });
    await auditService.log('finance_delete', req.home.slug, req.user.username, { id: idP.data, entity: 'expense' });
    res.json({ deleted: true });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.put('/expenses/:id/approve', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid expense ID' });
    const result = await financeService.approveExpense(idP.data, req.home.id, req.user.username);
    await auditService.log('finance_update', req.home.slug, req.user.username, { id: idP.data, entity: 'expense', action: 'approve' });
    res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.put('/expenses/:id/reject', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid expense ID' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 1000) : null;
    const result = await financeService.rejectExpense(idP.data, req.home.id, req.user.username, reason);
    await auditService.log('finance_update', req.home.slug, req.user.username, { id: idP.data, entity: 'expense', action: 'reject' });
    res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

// ── Chase Log ────────────────────────────────────────────────────────────────

router.get('/invoices/:id/chases', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid invoice ID' });
    res.json(await financeService.findChasesByInvoice(idP.data, req.home.id));
  } catch (err) { next(err); }
});

router.post('/invoices/:id/chases', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid invoice ID' });
    const parsed = chaseBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await financeService.createChase(req.home.id, { ...parsed.data, invoice_id: idP.data }, req.user.username);
    await auditService.log('finance_create', req.home.slug, req.user.username, { id: result.id, entity: 'chase', invoice_id: idP.data });
    res.status(201).json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

// ── Receivables Detail ───────────────────────────────────────────────────────

router.get('/receivables', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    res.json(await financeService.getReceivablesDetail(req.home.id));
  } catch (err) { next(err); }
});

// ── Payment Schedule ─────────────────────────────────────────────────────────

router.get('/payment-schedules', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const filters = { limit: pg.limit, offset: pg.offset };
    if (req.query.on_hold !== undefined) filters.onHold = req.query.on_hold === 'true';
    res.json(await financeService.findPaymentSchedules(req.home.id, filters));
  } catch (err) { next(err); }
});

router.post('/payment-schedules', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = paymentScheduleBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await financeService.createPaymentSchedule(req.home.id, parsed.data, req.user.username);
    await auditService.log('finance_create', req.home.slug, req.user.username, { id: result.id, entity: 'payment_schedule' });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.put('/payment-schedules/:id', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid schedule ID' });
    const parsed = paymentScheduleUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const existing = await financeService.findPaymentScheduleById(idP.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Payment schedule not found' });
    const version = parsed.data._version != null ? parsed.data._version : null;
    const result = await financeService.updatePaymentSchedule(idP.data, req.home.id, parsed.data, version);
    if (result === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    await auditService.log('finance_update', req.home.slug, req.user.username, { id: idP.data, entity: 'payment_schedule', changes: diffFields(existing, result) });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/payment-schedules/:id/process', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid schedule ID' });
    const result = await financeService.processScheduledPayment(idP.data, req.home.id, req.user.username);
    await auditService.log('finance_create', req.home.slug, req.user.username, { id: idP.data, entity: 'payment_schedule', action: 'process' });
    res.json(result);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.delete('/payment-schedules/:id', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid schedule ID' });
    const deleted = await financeService.softDeletePaymentSchedule(idP.data, req.home.id, req.user.username);
    if (!deleted) return res.status(404).json({ error: 'Payment schedule not found' });
    await auditService.log('finance_delete', req.home.slug, req.user.username, { id: idP.data, entity: 'payment_schedule' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ── Dashboard & Alerts ────────────────────────────────────────────────────────

router.get('/dashboard', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const now = new Date();
    const from = safeDate(req.query.from) || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const to = safeDate(req.query.to) || now.toISOString().slice(0, 10);
    if (from > to) return res.status(400).json({ error: '"from" date must not be after "to" date' });
    res.json(await financeService.getFinanceDashboard(req.home.id, from, to));
  } catch (err) { next(err); }
});

router.get('/alerts', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    res.json(await financeService.getFinanceAlerts(req.home.id));
  } catch (err) { next(err); }
});

export default router;
