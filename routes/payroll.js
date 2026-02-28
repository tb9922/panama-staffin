/**
 * routes/payroll.js — Payroll API endpoints.
 *
 * All routes require auth. Mutations require admin.
 * Home identified via ?home=slug query param (consistent with all other routes).
 *
 * Mounted at: /api/payroll
 *
 * Sections:
 *   /rates          — pay_rate_rules CRUD
 *   /nmw            — NMW rate lookup (read-only, public to any authenticated user)
 *   /timesheets     — timesheet entry + approval
 *   /runs           — payroll run lifecycle (create, calculate, approve, export)
 *   /agency         — agency providers + shifts + metrics
 */

import { Router }   from 'express';
import { z }        from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import { withTransaction } from '../db.js';
import * as payRateRulesRepo  from '../repositories/payRateRulesRepo.js';
import * as timesheetRepo     from '../repositories/timesheetRepo.js';
import * as payrollRunRepo    from '../repositories/payrollRunRepo.js';
import * as agencyRepo        from '../repositories/agencyRepo.js';
import * as taxRepo           from '../repositories/taxRepo.js';
import * as pensionRepo       from '../repositories/pensionRepo.js';
import * as sspRepo           from '../repositories/sspRepo.js';
import * as hmrcRepo          from '../repositories/hmrcRepo.js';
import * as payrollService    from '../services/payrollService.js';
import { generatePayslipPDF }  from '../src/lib/payslipPdf.js';
import { generateSummaryPDF }  from '../src/lib/payrollSummary.js';
import { NotFoundError, ValidationError } from '../errors.js';

const router = Router();

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const dateSchema     = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const ruleIdSchema   = z.coerce.number().int().positive();
const runIdSchema    = z.coerce.number().int().positive();
const tsIdSchema     = z.coerce.number().int().positive();
const providerSchema = z.coerce.number().int().positive();

const ruleBodySchema = z.object({
  name:           z.string().min(1).max(100),
  rate_type:      z.enum(['percentage', 'fixed_hourly', 'flat_per_shift']),
  amount:         z.number().positive(),
  applies_to:     z.enum(['night', 'weekend_sat', 'weekend_sun', 'bank_holiday', 'sleep_in', 'overtime', 'on_call']),
  priority:       z.number().int().optional().default(0),
  effective_from: dateSchema.optional(),
});

const timesheetBodySchema = z.object({
  staff_id:        z.string().min(1).max(20),
  date:            dateSchema,
  scheduled_start: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  scheduled_end:   z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  actual_start:    z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  actual_end:      z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  snapped_start:   z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  snapped_end:     z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  snap_applied:    z.boolean().optional().default(false),
  snap_minutes_saved: z.number().optional().default(0),
  break_minutes:   z.number().int().nonnegative().optional().default(0),
  payable_hours:   z.number().nonnegative().nullable().optional(),
  status:          z.enum(['pending', 'approved', 'disputed']).optional(),
  notes:           z.string().max(1000).nullable().optional(),
});

const runBodySchema = z.object({
  period_start:   dateSchema,
  period_end:     dateSchema,
  pay_frequency:  z.enum(['weekly', 'fortnightly', 'monthly']).default('monthly'),
  notes:          z.string().max(500).nullable().optional(),
});

const providerBodySchema = z.object({
  name:       z.string().min(1).max(200),
  contact:    z.string().max(200).nullable().optional(),
  rate_day:   z.number().positive().nullable().optional(),
  rate_night: z.number().positive().nullable().optional(),
  active:     z.boolean().optional().default(true),
});

const agencyShiftBodySchema = z.object({
  agency_id:    z.number().int().positive(),
  date:         dateSchema,
  shift_code:   z.enum(['AG-E', 'AG-L', 'AG-N']),
  hours:        z.number().positive(),
  hourly_rate:  z.number().positive(),
  worker_name:  z.string().max(200).nullable().optional(),
  invoice_ref:  z.string().max(100).nullable().optional(),
  reconciled:   z.boolean().optional().default(false),
  role_covered: z.string().max(100).nullable().optional(),
});

// ── Pay Rate Rules ─────────────────────────────────────────────────────────────

// GET /api/payroll/rates?home=X — list active rules (seeds defaults on first call)
router.get('/rates', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    // Seed defaults if none exist yet (idempotent)
    await payrollService.seedDefaultRulesIfNeeded(req.home.id);

    const rules = await payRateRulesRepo.findActiveByHome(req.home.id);
    res.json(rules);
  } catch (err) { next(err); }
});

// POST /api/payroll/rates?home=X — create rule
router.post('/rates', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = ruleBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const rule = await payRateRulesRepo.create(req.home.id, parsed.data);
    res.status(201).json(rule);
  } catch (err) { next(err); }
});

// PUT /api/payroll/rates/:ruleId?home=X — update rule (soft-close + create new version)
router.put('/rates/:ruleId', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const ruleId = ruleIdSchema.safeParse(req.params.ruleId);
    if (!ruleId.success) return res.status(400).json({ error: 'Invalid rule ID' });
    const parsed = ruleBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const rule = await payRateRulesRepo.update(ruleId.data, req.home.id, parsed.data);
    if (!rule) return res.status(404).json({ error: 'Rule not found or already closed' });
    res.json(rule);
  } catch (err) { next(err); }
});

// DELETE /api/payroll/rates/:ruleId?home=X — deactivate rule
router.delete('/rates/:ruleId', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const ruleId = ruleIdSchema.safeParse(req.params.ruleId);
    if (!ruleId.success) return res.status(400).json({ error: 'Invalid rule ID' });
    const ok = await payRateRulesRepo.deactivate(ruleId.data, req.home.id);
    if (!ok) return res.status(404).json({ error: 'Rule not found or already closed' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/payroll/nmw?date=YYYY-MM-DD — NMW rates for a date (auth-only, no admin required)
router.get('/nmw', requireAuth, async (req, res, next) => {
  try {
    const rates = await payRateRulesRepo.getAllNmwRates();
    res.json(rates);
  } catch (err) { next(err); }
});

// ── Timesheets ─────────────────────────────────────────────────────────────────

// GET /api/payroll/timesheets?home=X&date=YYYY-MM-DD — entries for a date
router.get('/timesheets', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const dateP = dateSchema.safeParse(req.query.date);
    if (!dateP.success) return res.status(400).json({ error: 'date parameter required (YYYY-MM-DD)' });
    const entries = await timesheetRepo.findByHomeAndDate(req.home.id, dateP.data);
    res.json(entries);
  } catch (err) { next(err); }
});

// GET /api/payroll/timesheets/period?home=X&start=X&end=X — period view
router.get('/timesheets/period', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const startP = dateSchema.safeParse(req.query.start);
    const endP   = dateSchema.safeParse(req.query.end);
    if (!startP.success || !endP.success) return res.status(400).json({ error: 'start and end date parameters required' });
    const entries = await timesheetRepo.findByHomePeriod(req.home.id, startP.data, endP.data, req.query.status || null, req.query.staff_id || null);
    res.json(entries);
  } catch (err) { next(err); }
});

// POST /api/payroll/timesheets?home=X — create or update entry
router.post('/timesheets', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = timesheetBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const entry = await timesheetRepo.upsert(req.home.id, parsed.data);
    res.status(201).json(entry);
  } catch (err) { next(err); }
});

// POST /api/payroll/timesheets/:id/approve?home=X — approve single entry
router.post('/timesheets/:id/approve', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = tsIdSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid timesheet ID' });
    const entry = await timesheetRepo.approve(idP.data, req.home.id, req.user.username);
    if (!entry) return res.status(404).json({ error: 'Entry not found or already locked' });
    res.json(entry);
  } catch (err) { next(err); }
});

// POST /api/payroll/timesheets/:id/dispute?home=X — dispute a single entry
router.post('/timesheets/:id/dispute', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = tsIdSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid timesheet ID' });
    const reasonP = z.string().min(1).max(500).safeParse(req.body.reason);
    if (!reasonP.success) return res.status(400).json({ error: 'reason required (1-500 characters)' });
    const entry = await timesheetRepo.dispute(idP.data, req.home.id, reasonP.data);
    if (!entry) return res.status(404).json({ error: 'Entry not found or already locked' });
    res.json(entry);
  } catch (err) { next(err); }
});

// POST /api/payroll/timesheets/bulk-approve?home=X — approve all pending for a date
router.post('/timesheets/bulk-approve', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const dateP = dateSchema.safeParse(req.body.date);
    if (!dateP.success) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
    const count = await timesheetRepo.bulkApproveByDate(req.home.id, dateP.data, req.user.username);
    res.json({ approved: count });
  } catch (err) { next(err); }
});

// POST /api/payroll/timesheets/batch-upsert?home=X — bulk create/update entries
router.post('/timesheets/batch-upsert', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) return res.status(400).json({ error: 'entries array required' });
    if (entries.length > 62) return res.status(400).json({ error: 'Maximum 62 entries per batch' });
    for (const e of entries) {
      const p = timesheetBodySchema.safeParse(e);
      if (!p.success) return res.status(400).json({ error: `Invalid entry for ${e.date}: ${p.error.issues[0].message}` });
    }
    const results = await withTransaction(async (client) => {
      return timesheetRepo.bulkUpsert(req.home.id, entries, client);
    });
    res.status(201).json(results);
  } catch (err) { next(err); }
});

// POST /api/payroll/timesheets/approve-range?home=X — approve all pending for a staff member in date range
router.post('/timesheets/approve-range', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const staffIdP = z.string().min(1).max(20).safeParse(req.body.staff_id);
    const startP = dateSchema.safeParse(req.body.start);
    const endP = dateSchema.safeParse(req.body.end);
    if (!staffIdP.success) return res.status(400).json({ error: 'staff_id required' });
    if (!startP.success || !endP.success) return res.status(400).json({ error: 'start and end dates required (YYYY-MM-DD)' });
    const count = await timesheetRepo.approveByStaffRange(req.home.id, staffIdP.data, startP.data, endP.data, req.user.username);
    res.json({ approved: count });
  } catch (err) { next(err); }
});

// ── Payroll Runs ──────────────────────────────────────────────────────────────

// GET /api/payroll/runs?home=X — list all runs
router.get('/runs', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const runs = await payrollRunRepo.findByHome(req.home.id);
    res.json(runs);
  } catch (err) { next(err); }
});

// POST /api/payroll/runs?home=X — create draft run
router.post('/runs', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = runBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    if (parsed.data.period_start >= parsed.data.period_end) {
      return res.status(400).json({ error: 'period_start must be before period_end' });
    }
    const run = await payrollRunRepo.create(req.home.id, parsed.data);
    res.status(201).json(run);
  } catch (err) { next(err); }
});

// GET /api/payroll/runs/:runId?home=X — get run with lines
router.get('/runs/:runId', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    const run   = await payrollRunRepo.findById(runIdP.data, req.home.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const lines = await payrollRunRepo.findLinesByRun(runIdP.data);
    res.json({ run, lines });
  } catch (err) { next(err); }
});

// POST /api/payroll/runs/:runId/calculate?home=X — trigger calculation
router.post('/runs/:runId/calculate', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    await payrollService.calculateRun(runIdP.data, req.home.id, req.home.slug, req.user.username);
    const run   = await payrollRunRepo.findById(runIdP.data, req.home.id);
    const lines = await payrollRunRepo.findLinesByRun(runIdP.data);
    res.json({ run, lines });
  } catch (err) { next(err); }
});

// POST /api/payroll/runs/:runId/approve?home=X — approve run (blocks if NMW violations)
router.post('/runs/:runId/approve', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    await payrollService.approveRun(runIdP.data, req.home.id, req.home.slug, req.user.username);
    const run = await payrollRunRepo.findById(runIdP.data, req.home.id);
    res.json(run);
  } catch (err) { next(err); }
});

// GET /api/payroll/runs/:runId/export?home=X&format=sage|xero|generic — CSV download
router.get('/runs/:runId/export', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    const format = ['sage', 'xero', 'generic'].includes(req.query.format)
      ? req.query.format
      : 'generic';
    const { csv, filename } = await payrollService.exportRunCSV(
      runIdP.data, req.home.id, req.home.slug, req.user.username, format,
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/payroll/runs/:runId/payslips/:staffId?home=X — single payslip PDF
router.get('/runs/:runId/payslips/:staffId', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    const staffId = req.params.staffId;
    const payslips = await payrollService.assemblePayslipData(runIdP.data, req.home.id, staffId);
    if (!payslips.length) return res.status(404).json({ error: 'No payslip data found for this staff member' });
    const pdf = generatePayslipPDF(payslips[0]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip_${staffId}_${payslips[0].run.period_start}.pdf"`);
    res.send(Buffer.from(pdf.output('arraybuffer')));
  } catch (err) { next(err); }
});

// GET /api/payroll/runs/:runId/payslips?home=X — bulk payslip data (JSON, frontend renders PDF)
router.get('/runs/:runId/payslips', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    const payslips = await payrollService.assemblePayslipData(runIdP.data, req.home.id, null);
    res.json(payslips);
  } catch (err) { next(err); }
});

// ── Agency ────────────────────────────────────────────────────────────────────

// GET /api/payroll/agency/providers?home=X
router.get('/agency/providers', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    res.json(await agencyRepo.findProvidersByHome(req.home.id));
  } catch (err) { next(err); }
});

// POST /api/payroll/agency/providers?home=X
router.post('/agency/providers', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = providerBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const provider = await agencyRepo.createProvider(req.home.id, parsed.data);
    res.status(201).json(provider);
  } catch (err) { next(err); }
});

// PUT /api/payroll/agency/providers/:id?home=X
router.put('/agency/providers/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = providerSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid provider ID' });
    const parsed = providerBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const provider = await agencyRepo.updateProvider(idP.data, req.home.id, parsed.data);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });
    res.json(provider);
  } catch (err) { next(err); }
});

// GET /api/payroll/agency/shifts?home=X&start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/agency/shifts', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const startP = dateSchema.safeParse(req.query.start);
    const endP   = dateSchema.safeParse(req.query.end);
    if (!startP.success || !endP.success) return res.status(400).json({ error: 'start and end required' });
    res.json(await agencyRepo.findShiftsByHomePeriod(req.home.id, startP.data, endP.data));
  } catch (err) { next(err); }
});

// POST /api/payroll/agency/shifts?home=X
router.post('/agency/shifts', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = agencyShiftBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    // Calculate total_cost server-side
    const data = { ...parsed.data, total_cost: Math.round(parsed.data.hours * parsed.data.hourly_rate * 100) / 100 };
    const shift = await agencyRepo.createShift(req.home.id, data);
    res.status(201).json(shift);
  } catch (err) { next(err); }
});

// PUT /api/payroll/agency/shifts/:id?home=X
router.put('/agency/shifts/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = providerSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid shift ID' });
    const parsed = agencyShiftBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const data = { ...parsed.data, total_cost: Math.round(parsed.data.hours * parsed.data.hourly_rate * 100) / 100 };
    const shift = await agencyRepo.updateShift(idP.data, req.home.id, data);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    res.json(shift);
  } catch (err) { next(err); }
});

// GET /api/payroll/agency/metrics?home=X&weeks=12
router.get('/agency/metrics', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const weeks = Math.min(52, Math.max(1, parseInt(req.query.weeks, 10) || 12));
    res.json(await agencyRepo.getMetrics(req.home.id, weeks));
  } catch (err) { next(err); }
});

// ── Phase 2: Tax Codes ────────────────────────────────────────────────────────

const taxCodeBodySchema = z.object({
  staff_id:          z.string().min(1).max(20),
  tax_code:          z.string().min(1).max(20).optional().default('1257L'),
  basis:             z.enum(['cumulative', 'w1m1']).optional().default('cumulative'),
  ni_category:       z.string().length(1).optional().default('A'),
  effective_from:    dateSchema.optional(),
  previous_pay:      z.number().nonnegative().optional().default(0),
  previous_tax:      z.number().nonnegative().optional().default(0),
  student_loan_plan: z.string().max(20).nullable().optional(),
  source:            z.enum(['manual', 'p45', 'hmrc_notice']).optional().default('manual'),
  notes:             z.string().max(1000).nullable().optional(),
});

// GET /api/payroll/tax-codes?home=X
router.get('/tax-codes', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    res.json(await taxRepo.listTaxCodesByHome(req.home.id));
  } catch (err) { next(err); }
});

// POST /api/payroll/tax-codes?home=X
router.post('/tax-codes', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = taxCodeBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    res.status(201).json(await taxRepo.upsertTaxCode(req.home.id, parsed.data));
  } catch (err) { next(err); }
});

// GET /api/payroll/ytd?home=X&staffId=X&year=X
router.get('/ytd', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const staffId = z.string().min(1).max(20).safeParse(req.query.staffId);
    const year    = z.coerce.number().int().min(2020).safeParse(req.query.year);
    if (!staffId.success || !year.success) return res.status(400).json({ error: 'staffId and year are required' });
    const ytd = await taxRepo.getYTD(req.home.id, staffId.data, year.data);
    res.json(ytd || null);
  } catch (err) { next(err); }
});

// ── Phase 2: Pensions ─────────────────────────────────────────────────────────

const enrolmentBodySchema = z.object({
  staff_id:          z.string().min(1).max(20),
  status:            z.enum(['pending_assessment', 'eligible_enrolled', 'opted_out', 'postponed', 'opt_in_enrolled', 'entitled_not_enrolled']),
  enrolled_date:     dateSchema.nullable().optional(),
  opted_out_date:    dateSchema.nullable().optional(),
  postponed_until:   dateSchema.nullable().optional(),
  reassessment_date: dateSchema.nullable().optional(),
  notes:             z.string().max(1000).nullable().optional(),
});

// GET /api/payroll/pensions?home=X
router.get('/pensions', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    res.json(await pensionRepo.listEnrolmentsByHome(req.home.id));
  } catch (err) { next(err); }
});

// POST /api/payroll/pensions?home=X
router.post('/pensions', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = enrolmentBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    res.status(201).json(await pensionRepo.upsertEnrolment(req.home.id, parsed.data));
  } catch (err) { next(err); }
});

// GET /api/payroll/pension-config
router.get('/pension-config', requireAuth, async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const config = await pensionRepo.getPensionConfig(today);
    res.json(config || {});
  } catch (err) { next(err); }
});

// ── Phase 2: SSP & Sick Periods ───────────────────────────────────────────────

// GET /api/payroll/ssp-config
router.get('/ssp-config', requireAuth, async (req, res, next) => {
  try {
    const configs = await sspRepo.getAllSSPConfigs();
    res.json(configs);
  } catch (err) { next(err); }
});

const sickPeriodBodySchema = z.object({
  staff_id:                z.string().min(1).max(20),
  start_date:              dateSchema,
  end_date:                dateSchema.nullable().optional(),
  qualifying_days_per_week: z.number().int().min(1).max(7).optional().default(5),
  waiting_days_served:     z.number().int().nonnegative().optional().default(0),
  ssp_weeks_paid:          z.number().nonnegative().optional().default(0),
  fit_note_received:       z.boolean().optional().default(false),
  fit_note_date:           dateSchema.nullable().optional(),
  linked_to_period_id:     z.number().int().positive().nullable().optional(),
  notes:                   z.string().max(1000).nullable().optional(),
});

const sickPeriodUpdateSchema = z.object({
  end_date:          dateSchema.nullable().optional(),
  waiting_days_served: z.number().int().nonnegative().optional(),
  ssp_weeks_paid:    z.number().nonnegative().optional(),
  fit_note_received: z.boolean().optional(),
  fit_note_date:     dateSchema.nullable().optional(),
  notes:             z.string().max(1000).nullable().optional(),
});

// GET /api/payroll/sick-periods?home=X[&staffId=X]
router.get('/sick-periods', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const staffId = req.query.staffId || null;
    res.json(await sspRepo.listSickPeriods(req.home.id, staffId));
  } catch (err) { next(err); }
});

// POST /api/payroll/sick-periods?home=X
router.post('/sick-periods', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = sickPeriodBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    res.status(201).json(await sspRepo.createSickPeriod(req.home.id, parsed.data));
  } catch (err) { next(err); }
});

// PUT /api/payroll/sick-periods/:id?home=X
router.put('/sick-periods/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid period ID' });
    const parsed = sickPeriodUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const updated = await sspRepo.updateSickPeriod(idP.data, req.home.id, parsed.data);
    if (!updated) return res.status(404).json({ error: 'Sick period not found' });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Phase 2: HMRC Liability Tracker ──────────────────────────────────────────

const markPaidSchema = z.object({
  paid_date:      dateSchema,
  paid_reference: z.string().max(100).nullable().optional(),
});

// GET /api/payroll/hmrc?home=X&year=X
router.get('/hmrc', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const year = z.coerce.number().int().min(2020).safeParse(req.query.year);
    if (!year.success) return res.status(400).json({ error: 'year is required' });
    // Refresh overdue status before returning
    await hmrcRepo.refreshOverdueStatus(req.home.id);
    res.json(await hmrcRepo.listLiabilities(req.home.id, year.data));
  } catch (err) { next(err); }
});

// PUT /api/payroll/hmrc/:id/paid?home=X
router.put('/hmrc/:id/paid', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idP = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid liability ID' });
    const parsed = markPaidSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const updated = await hmrcRepo.markPaid(idP.data, req.home.id, parsed.data.paid_date, parsed.data.paid_reference);
    if (!updated) return res.status(404).json({ error: 'Liability not found' });
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/payroll/runs/:runId/summary-pdf?home=X — payroll summary PDF for accountant
// Admin only, approved/exported/locked runs only
router.get('/runs/:runId/summary-pdf', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    const run = await payrollRunRepo.findById(runIdP.data, req.home.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (!['approved', 'exported', 'locked'].includes(run.status)) {
      return res.status(400).json({ error: 'Summary PDF only available for approved runs' });
    }
    const lines = await payrollRunRepo.findLinesByRun(runIdP.data);
    const doc = generateSummaryPDF(run, lines, { name: req.home.config?.home_name || req.home.name });
    const buffer = Buffer.from(doc.output('arraybuffer'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="payroll_summary_${run.period_start}_${run.period_end}.pdf"`,
    );
    res.send(buffer);
  } catch (err) { next(err); }
});

export default router;
