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
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { withTransaction } from '../db.js';
import * as payRateRulesRepo  from '../repositories/payRateRulesRepo.js';
import * as timesheetRepo     from '../repositories/timesheetRepo.js';
import * as shiftHourAdjustmentRepo from '../repositories/shiftHourAdjustmentRepo.js';
import * as payrollRunRepo    from '../repositories/payrollRunRepo.js';
import * as agencyRepo        from '../repositories/agencyRepo.js';
import * as agencyAttemptRepo from '../repositories/agencyAttemptRepo.js';
import * as taxRepo           from '../repositories/taxRepo.js';
import * as pensionRepo       from '../repositories/pensionRepo.js';
import * as sspRepo           from '../repositories/sspRepo.js';
import * as hmrcRepo          from '../repositories/hmrcRepo.js';
import * as staffRepo         from '../repositories/staffRepo.js';
import * as overrideRepo      from '../repositories/overrideRepo.js';
import * as payrollService    from '../services/payrollService.js';
import * as auditService      from '../services/auditService.js';
import { dispatchEvent }      from '../services/webhookService.js';

import { generatePayslipPDF }  from '../lib/payslipPdf.js';
import { generateSummaryPDF }  from '../lib/payrollSummary.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { isOwnDataOnly } from '../shared/roles.js';
import { nullableDateInput, requiredDateInput } from '../lib/zodHelpers.js';
import { todayLocalISO } from '../lib/dateOnly.js';
import { calculateAccrual } from '../src/lib/accrual.js';
import { getActualShift, getLeaveYear, getShiftHours, isWorkingShift } from '../shared/rotation.js';

const router = Router();
const SENSITIVE_DOWNLOAD_CACHE_CONTROL = 'no-store, no-cache, must-revalidate, private';
const OWN_DATA_PAYROLL_STATUSES = ['approved', 'exported', 'locked'];

/**
 * For own-data roles (staff_member): require a linked staff_id.
 * Returns true (and sends 403) if own-data role has no staff link.
 * Usage: if (requireStaffLink(req, res, 'payroll')) return;
 */
function requireStaffLink(req, res, moduleId) {
  if (!isOwnDataOnly(req.homeRole, moduleId)) return false;
  if (!req.staffId) {
    res.status(403).json({ error: 'No staff link configured' });
    return true;
  }
  return false;
}

/**
 * Guard for home-level payroll data that staff_member must not see.
 * Returns true (and sends 403) if staff_member tries to access.
 */
function blockOwnDataRole(req, res, moduleId) {
  if (isOwnDataOnly(req.homeRole, moduleId)) {
    res.status(403).json({ error: 'Access restricted to managers and officers' });
    return true;
  }
  return false;
}

function shapeOwnPayrollRunSummary(run) {
  if (!run) return run;
  return {
    id: run.id,
    period_start: run.period_start,
    period_end: run.period_end,
    pay_date: run.pay_date,
    pay_frequency: run.pay_frequency,
    status: run.status,
    exported_at: run.exported_at || null,
  };
}

function shapeOwnPayrollRunDetail(run) {
  if (!run) return run;
  return {
    id: run.id,
    period_start: run.period_start,
    period_end: run.period_end,
    pay_date: run.pay_date,
    pay_frequency: run.pay_frequency,
    status: run.status,
    exported_at: run.exported_at || null,
  };
}

function shapeOwnPayslipData(payslip) {
  if (!payslip) return payslip;
  return {
    ...payslip,
    run: shapeOwnPayrollRunDetail(payslip.run),
    home: payslip.home ? { name: payslip.home.name } : null,
  };
}

async function assertPayrollStaffExists(homeId, staffId, client) {
  const staff = await staffRepo.findById(homeId, staffId, client);
  if (!staff) throw new NotFoundError('Staff member not found');
  return staff;
}

function dayDiffIso(laterIso, earlierIso) {
  const later = Date.parse(`${laterIso}T00:00:00Z`);
  const earlier = Date.parse(`${earlierIso}T00:00:00Z`);
  return Math.floor((later - earlier) / 86400000);
}

async function resolveLinkedSickPeriod(homeId, staffId, startDate, linkedToPeriodId, client) {
  if (!linkedToPeriodId) {
    return sspRepo.findRecentClosedPeriod(homeId, staffId, startDate, 56, client);
  }

  const linked = await sspRepo.findSickPeriodById(linkedToPeriodId, homeId, client);
  if (!linked) throw new ValidationError('Linked sick period not found');
  if (linked.staff_id !== staffId) {
    throw new ValidationError('Linked sick period must belong to the same staff member');
  }
  if (!linked.end_date) {
    throw new ValidationError('Linked sick period must be closed before it can be linked');
  }
  if (linked.end_date >= startDate) {
    throw new ValidationError('Linked sick period must end before the new period starts');
  }
  if (dayDiffIso(startDate, linked.end_date) > 56) {
    throw new ValidationError('Linked sick period must have ended within the last 56 days');
  }
  return linked;
}

async function assertNoSickPeriodOverlap(homeId, staffId, startDate, endDate, excludeId, client) {
  const overlaps = await sspRepo.findOverlappingSickPeriods(homeId, staffId, startDate, endDate, excludeId, client);
  if (overlaps.length > 0) {
    throw new ValidationError('Sick period overlaps an existing period for this staff member');
  }
}

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const dateSchema     = nullableDateInput;
const requiredDateSchema = requiredDateInput;
const optTime        = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{2}:\d{2}$/).nullable().optional());
const ruleIdSchema   = z.coerce.number().int().positive();
const runIdSchema    = z.coerce.number().int().positive();
const tsIdSchema     = z.coerce.number().int().positive();
const providerSchema = z.coerce.number().int().positive();
const safeStr = (v, max = 50) => typeof v === 'string' ? v.slice(0, max) : null;

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
  date:            requiredDateSchema,
  scheduled_start: optTime,
  scheduled_end:   optTime,
  actual_start:    optTime,
  actual_end:      optTime,
  snapped_start:   optTime,
  snapped_end:     optTime,
  snap_applied:    z.boolean().optional().default(false),
  snap_minutes_saved: z.number().optional().default(0),
  break_minutes:   z.number().int().nonnegative().optional().default(0),
  payable_hours:   z.number().nonnegative().nullable().optional(),
  // status deliberately excluded — set only via dedicated approve/dispute routes
  notes:           z.string().max(1000).nullable().optional(),
});

const runBodySchema = z.object({
  period_start:   requiredDateSchema,
  period_end:     requiredDateSchema,
  pay_date:       dateSchema.optional(),
  pay_frequency:  z.enum(['weekly', 'fortnightly', 'monthly']).default('monthly'),
  notes:          z.string().max(500).nullable().optional(),
});

const providerBodySchema = z.object({
  name:       z.string().min(1).max(200),
  contact:    z.string().max(200).nullable().optional(),
  rate_day:   z.number().positive().nullable().optional(),
  rate_night: z.number().positive().nullable().optional(),
  active:     z.boolean().optional().default(true),
  _version:   z.number().int().nonnegative().optional(),
});

const agencyShiftBodySchema = z.object({
  agency_id:    z.number().int().positive(),
  date:         requiredDateSchema,
  shift_code:   z.enum(['AG-E', 'AG-L', 'AG-N']),
  hours:        z.number().positive(),
  hourly_rate:  z.number().positive(),
  worker_name:  z.string().max(200).nullable().optional(),
  invoice_ref:  z.string().max(100).nullable().optional(),
  reconciled:   z.boolean().optional().default(false),
  role_covered: z.string().max(100).nullable().optional(),
  agency_attempt_id: z.coerce.number().int().positive().nullable().optional(),
  _version:     z.number().int().nonnegative().optional(),
});

const timesheetBatchBodySchema = z.object({
  entries: z.array(z.unknown()).min(1, 'entries array required').max(62, 'Maximum 62 entries per batch'),
});

const hourAdjustmentBodySchema = z.object({
  staff_id: z.string().min(1).max(20),
  date: requiredDateSchema,
  kind: z.enum(['annual_leave', 'paid_authorised_absence']),
  hours: z.number().positive().max(24),
  note: z.string().max(500).nullable().optional(),
  source: z.string().max(20).optional().default('manual'),
});

function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function agencyAttemptErrorForShift(attempt, shiftData, existingShiftId = null) {
  if (!attempt) return 'Agency approval attempt is required before logging agency';
  if (attempt.gap_date !== shiftData.date) return 'Agency attempt date must match the agency shift date';
  if (attempt.shift_code !== shiftData.shift_code) return 'Agency attempt shift code must match the agency shift';
  if (attempt.linked_agency_shift_id && Number(attempt.linked_agency_shift_id) !== Number(existingShiftId)) {
    return 'Agency attempt is already linked to another agency shift';
  }
  if (attempt.emergency_override) {
    if (!attempt.emergency_override_reason) return 'Emergency override reason is required';
    return null;
  }
  if (!attempt.internal_bank_checked) {
    return 'Internal bank check is required before non-emergency agency is logged';
  }
  if (attempt.overtime_accepted) {
    return 'Overtime was accepted, so agency cannot be logged without an emergency override';
  }
  if ((attempt.viable_internal_candidate_count || 0) > 0) {
    return 'Viable internal-bank candidates exist; use emergency override with a reason to proceed with agency';
  }
  return null;
}

async function getHourAdjustmentContext(home, staffId, date, client, payableHoursOverride = undefined) {
  const staff = await staffRepo.findById(home.id, staffId, client);
  const overrides = await overrideRepo.findByHome(home.id, date, date, client);
  const existingAdjustment = await shiftHourAdjustmentRepo.findByStaffDate(home.id, staffId, date, client);
  const existingTimesheet = await timesheetRepo.findByStaffDate(home.id, staffId, date, client);

  if (!staff || staff.active === false) {
    throw new NotFoundError('Staff member not found');
  }

  const existingOverride = overrides?.[date]?.[staffId] || null;
  const actual = getActualShift(staff, date, overrides, home.config?.cycle_start_date, home.config || {});
  const shift = typeof actual === 'string' ? actual : actual?.shift || 'OFF';
  const rosterHours = isWorkingShift(shift) ? getShiftHours(shift, home.config || {}) : 0;
  const payableHours = payableHoursOverride ?? existingTimesheet?.payable_hours ?? null;
  const shortfallHours = payableHours != null
    ? round2(Math.max(0, rosterHours - Number(payableHours)))
    : 0;

  return {
    staff,
    shift,
    rosterHours,
    payableHours,
    shortfallHours,
    existingAdjustment,
    existingOverride,
    existingTimesheet,
  };
}

async function validateHourAdjustmentUpsert(home, payload, client) {
  const context = await getHourAdjustmentContext(home, payload.staff_id, payload.date, client);

  if (context.existingTimesheet?.status === 'locked') {
    throw new ValidationError('Timesheet is locked for payroll and cannot be adjusted');
  }
  if (context.existingOverride?.shift === 'AL') {
    throw new ValidationError('Remove the full-day AL override before adding an hourly adjustment');
  }
  if (!isWorkingShift(context.shift) || context.rosterHours <= 0) {
    throw new ValidationError('Hourly adjustments are only available on rostered working shifts');
  }
  if (context.payableHours == null) {
    throw new ValidationError('Record the worked hours first, then resolve the shortfall');
  }
  if (context.shortfallHours <= 0) {
    throw new ValidationError('This day has no unpaid shortfall to resolve');
  }
  if (payload.hours > context.shortfallHours + 0.05) {
    throw new ValidationError(`Adjustment cannot exceed the current shortfall (${context.shortfallHours.toFixed(2)}h)`);
  }

  if (payload.kind === 'annual_leave') {
    const leaveYear = getLeaveYear(payload.date, home.config?.leave_year_start);
    const hourAdjustments = await shiftHourAdjustmentRepo.findMapByHomePeriod(
      home.id,
      leaveYear.startStr,
      leaveYear.endStr,
      payload.staff_id,
      client,
    );

    if (hourAdjustments?.[payload.date]?.[payload.staff_id]) {
      delete hourAdjustments[payload.date][payload.staff_id];
      if (Object.keys(hourAdjustments[payload.date]).length === 0) delete hourAdjustments[payload.date];
    }

    const overrides = await overrideRepo.findByHome(home.id, leaveYear.startStr, leaveYear.endStr, client);
    const accrual = calculateAccrual(context.staff, home.config || {}, overrides, payload.date, hourAdjustments);
    if (accrual.missingContractHours) {
      throw new ValidationError('Contract hours must be set before using hourly annual leave');
    }
    if (payload.hours > accrual.remainingHours + 0.05) {
      throw new ValidationError(`Only ${accrual.remainingHours.toFixed(1)}h of earned leave is available for that date`);
    }
  }

  return context;
}

async function assertTimesheetCompatibleWithAdjustment(home, entry, client) {
  const context = await getHourAdjustmentContext(home, entry.staff_id, entry.date, client, entry.payable_hours);
  if (!context.existingAdjustment) return;
  if (context.existingTimesheet?.status === 'locked') return;
  if (context.shortfallHours <= 0) {
    throw new ValidationError('Remove the hourly adjustment before saving a full-hours timesheet entry');
  }
  if (context.existingAdjustment.hours > context.shortfallHours + 0.05) {
    throw new ValidationError(
      `Existing hourly adjustment (${context.existingAdjustment.hours.toFixed(2)}h) exceeds the new shortfall (${context.shortfallHours.toFixed(2)}h). Update or remove the adjustment first.`,
    );
  }
}

// ── Pay Rate Rules ─────────────────────────────────────────────────────────────

// GET /api/payroll/rates?home=X — list active rules (seeds defaults on first call)
router.get('/rates', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read'), async (req, res, next) => {
  try {
    if (blockOwnDataRole(req, res, 'payroll')) return;
    // Seed defaults if none exist yet (idempotent, wrapped in transaction for atomicity)
    await withTransaction((client) => payrollService.seedDefaultRulesIfNeeded(req.home.id, client));

    const rules = await payRateRulesRepo.findActiveByHome(req.home.id);
    res.json(rules);
  } catch (err) { next(err); }
});

// POST /api/payroll/rates?home=X — create rule
router.post('/rates', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const parsed = ruleBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const rule = await payRateRulesRepo.create(req.home.id, parsed.data);
    await auditService.log('payroll_create', req.home.slug, req.user.username, { id: rule.id, entity: 'rate_rule' });
    res.status(201).json(rule);
  } catch (err) { next(err); }
});

// PUT /api/payroll/rates/:ruleId?home=X — update rule (soft-close + create new version)
router.put('/rates/:ruleId', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const ruleId = ruleIdSchema.safeParse(req.params.ruleId);
    if (!ruleId.success) return res.status(400).json({ error: 'Invalid rule ID' });
    const parsed = ruleBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const rule = await payRateRulesRepo.update(ruleId.data, req.home.id, parsed.data);
    if (!rule) return res.status(404).json({ error: 'Rule not found or already closed' });
    await auditService.log('payroll_update', req.home.slug, req.user.username, { id: ruleId.data, entity: 'rate_rule' });
    res.json(rule);
  } catch (err) { next(err); }
});

// DELETE /api/payroll/rates/:ruleId?home=X — deactivate rule
router.delete('/rates/:ruleId', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const ruleId = ruleIdSchema.safeParse(req.params.ruleId);
    if (!ruleId.success) return res.status(400).json({ error: 'Invalid rule ID' });
    const ok = await payRateRulesRepo.deactivate(ruleId.data, req.home.id);
    if (!ok) return res.status(404).json({ error: 'Rule not found or already closed' });
    await auditService.log('payroll_delete', req.home.slug, req.user.username, { id: ruleId.data, entity: 'rate_rule' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/payroll/nmw?date=YYYY-MM-DD — NMW rates for a date (auth-only, no admin required)
router.get('/nmw', readRateLimiter, requireAuth, async (req, res, next) => {
  try {
    const rates = await payRateRulesRepo.getAllNmwRates();
    res.json(rates);
  } catch (err) { next(err); }
});

// ── Timesheets ─────────────────────────────────────────────────────────────────

// GET /api/payroll/timesheets?home=X&date=YYYY-MM-DD — entries for a date
router.get('/timesheets', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read', { allowOwn: true }), async (req, res, next) => {
  try {
    const dateP = dateSchema.safeParse(req.query.date);
    if (!dateP.success) return res.status(400).json({ error: 'date parameter required (YYYY-MM-DD)' });
    if (requireStaffLink(req, res, 'payroll')) return;
    let entries = await timesheetRepo.findByHomeAndDate(req.home.id, dateP.data);
    if (isOwnDataOnly(req.homeRole, 'payroll')) {
      entries = entries.filter(e => e.staff_id === req.staffId);
    }
    res.json(entries);
  } catch (err) { next(err); }
});

// GET /api/payroll/timesheets/period?home=X&start=X&end=X — period view
router.get('/timesheets/period', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read', { allowOwn: true }), async (req, res, next) => {
  try {
    const startP = dateSchema.safeParse(req.query.start);
    const endP   = dateSchema.safeParse(req.query.end);
    if (!startP.success || !endP.success) return res.status(400).json({ error: 'start and end date parameters required' });
    if (requireStaffLink(req, res, 'payroll')) return;
    // staff_member: force filter to own staff ID
    const staffIdFilter = isOwnDataOnly(req.homeRole, 'payroll')
      ? req.staffId
      : safeStr(req.query.staff_id, 20);
    const entries = await timesheetRepo.findByHomePeriod(req.home.id, startP.data, endP.data, safeStr(req.query.status, 20), staffIdFilter);
    res.json(entries);
  } catch (err) { next(err); }
});

router.get('/timesheets/adjustments/period', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read', { allowOwn: true }), async (req, res, next) => {
  try {
    const startP = dateSchema.safeParse(req.query.start);
    const endP = dateSchema.safeParse(req.query.end);
    if (!startP.success || !endP.success) return res.status(400).json({ error: 'start and end date parameters required' });
    if (requireStaffLink(req, res, 'payroll')) return;
    const staffIdFilter = isOwnDataOnly(req.homeRole, 'payroll')
      ? req.staffId
      : safeStr(req.query.staff_id, 20);
    const adjustments = await shiftHourAdjustmentRepo.findByHomePeriod(req.home.id, startP.data, endP.data, staffIdFilter);
    res.json(adjustments);
  } catch (err) { next(err); }
});

// POST /api/payroll/timesheets?home=X — create or update entry
router.post('/timesheets', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const parsed = timesheetBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const entry = await withTransaction(async (client) => {
      await assertTimesheetCompatibleWithAdjustment(req.home, parsed.data, client);
      return timesheetRepo.upsert(req.home.id, parsed.data, client);
    });
    await auditService.log('payroll_create', req.home.slug, req.user.username, { id: entry.id, entity: 'timesheet', staff_id: parsed.data.staff_id });
    res.status(201).json(entry);
  } catch (err) { next(err); }
});

router.put('/timesheets/adjustments', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const parsed = hourAdjustmentBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const adjustment = await withTransaction(async (client) => {
      const context = await validateHourAdjustmentUpsert(req.home, parsed.data, client);
      const saved = await shiftHourAdjustmentRepo.upsert(req.home.id, parsed.data, client);
      await auditService.log('payroll_update', req.home.slug, req.user.username, {
        entity: 'shift_hour_adjustment',
        action: context.existingAdjustment ? 'update' : 'create',
        staff_id: parsed.data.staff_id,
        date: parsed.data.date,
        kind: parsed.data.kind,
        hours: parsed.data.hours,
      }, client);
      return saved;
    });
    res.status(201).json(adjustment);
  } catch (err) { next(err); }
});

router.delete('/timesheets/adjustments', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const staffIdP = z.string().min(1).max(20).safeParse(req.query.staff_id);
    const dateP = dateSchema.safeParse(req.query.date);
    if (!staffIdP.success || !dateP.success) return res.status(400).json({ error: 'staff_id and date are required' });
    const deleted = await withTransaction(async (client) => {
      const existing = await shiftHourAdjustmentRepo.findByStaffDate(req.home.id, staffIdP.data, dateP.data, client);
      if (!existing) return false;
      const timesheet = await timesheetRepo.findByStaffDate(req.home.id, staffIdP.data, dateP.data, client);
      if (timesheet?.status === 'locked') {
        throw new ValidationError('Timesheet is locked for payroll and the adjustment cannot be removed');
      }
      const ok = await shiftHourAdjustmentRepo.deleteOne(req.home.id, staffIdP.data, dateP.data, client);
      if (ok) {
        await auditService.log('payroll_update', req.home.slug, req.user.username, {
          entity: 'shift_hour_adjustment',
          action: 'delete',
          staff_id: staffIdP.data,
          date: dateP.data,
        }, client);
      }
      return ok;
    });
    if (!deleted) return res.status(404).json({ error: 'Hourly adjustment not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/payroll/timesheets/:id/approve?home=X — approve single entry
router.post('/timesheets/:id/approve', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const idP = tsIdSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid timesheet ID' });
    const entry = await timesheetRepo.approve(idP.data, req.home.id, req.user.username);
    if (!entry) return res.status(404).json({ error: 'Entry not found or already locked' });
    await auditService.log('payroll_update', req.home.slug, req.user.username, { id: idP.data, entity: 'timesheet', action: 'approve' });
    res.json(entry);
  } catch (err) { next(err); }
});

// POST /api/payroll/timesheets/:id/dispute?home=X — dispute a single entry
router.post('/timesheets/:id/dispute', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const idP = tsIdSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid timesheet ID' });
    const reasonP = z.string().min(1).max(500).safeParse(req.body.reason);
    if (!reasonP.success) return res.status(400).json({ error: 'reason required (1-500 characters)' });
    const entry = await timesheetRepo.dispute(idP.data, req.home.id, reasonP.data);
    if (!entry) return res.status(404).json({ error: 'Entry not found or already locked' });
    await auditService.log('payroll_update', req.home.slug, req.user.username, { id: idP.data, entity: 'timesheet', action: 'dispute' });
    res.json(entry);
  } catch (err) { next(err); }
});

// POST /api/payroll/timesheets/bulk-approve?home=X — approve all pending for a date
router.post('/timesheets/bulk-approve', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const dateP = dateSchema.safeParse(req.body.date);
    if (!dateP.success) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
    const count = await timesheetRepo.bulkApproveByDate(req.home.id, dateP.data, req.user.username);
    await auditService.log('payroll_update', req.home.slug, req.user.username, { entity: 'timesheet', action: 'bulk_approve', date: dateP.data, count });
    res.json({ approved: count });
  } catch (err) { next(err); }
});

// POST /api/payroll/timesheets/batch-upsert?home=X — bulk create/update entries
router.post('/timesheets/batch-upsert', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const bodyParsed = timesheetBatchBodySchema.safeParse(req.body);
    if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.issues[0].message });
    const { entries } = bodyParsed.data;
    const parsed = [];
    for (const e of entries) {
      const p = timesheetBodySchema.safeParse(e);
      if (!p.success) return res.status(400).json({ error: `Invalid entry for ${e.date}: ${p.error.issues[0].message}` });
      parsed.push(p.data);
    }
    const results = await withTransaction(async (client) => {
      for (const entry of parsed) {
        await assertTimesheetCompatibleWithAdjustment(req.home, entry, client);
      }
      return timesheetRepo.bulkUpsert(req.home.id, parsed, client);
    });
    await auditService.log('payroll_create', req.home.slug, req.user.username, { entity: 'timesheet', action: 'batch_upsert', count: results.length });
    res.status(201).json(results);
  } catch (err) { next(err); }
});

// POST /api/payroll/timesheets/approve-range?home=X — approve all pending for a staff member in date range
router.post('/timesheets/approve-range', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const staffIdP = z.string().min(1).max(20).safeParse(req.body.staff_id);
    const startP = dateSchema.safeParse(req.body.start);
    const endP = dateSchema.safeParse(req.body.end);
    if (!staffIdP.success) return res.status(400).json({ error: 'staff_id required' });
    if (!startP.success || !endP.success) return res.status(400).json({ error: 'start and end dates required (YYYY-MM-DD)' });
    const count = await timesheetRepo.approveByStaffRange(req.home.id, staffIdP.data, startP.data, endP.data, req.user.username);
    await auditService.log('payroll_update', req.home.slug, req.user.username, { entity: 'timesheet', action: 'approve_range', staff_id: staffIdP.data, count });
    res.json({ approved: count });
  } catch (err) { next(err); }
});

// ── Payroll Runs ──────────────────────────────────────────────────────────────

// GET /api/payroll/runs?home=X — list all runs
router.get('/runs', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read', { allowOwn: true }), async (req, res, next) => {
  try {
    if (requireStaffLink(req, res, 'payroll')) return;
    const rawLimit = Number.parseInt(req.query.limit, 10);
    const rawOffset = Number.parseInt(req.query.offset, 10);
    const limit = Math.min(500, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 100));
    const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);
    const ownData = isOwnDataOnly(req.homeRole, 'payroll');
    const { rows, total } = await payrollRunRepo.findByHome(req.home.id, {
      limit,
      offset,
      staffId: ownData ? req.staffId : null,
      statuses: ownData ? OWN_DATA_PAYROLL_STATUSES : null,
    });
    if (isOwnDataOnly(req.homeRole, 'payroll')) {
      return res.json({ rows: rows.map(shapeOwnPayrollRunSummary), total });
    }
    res.json({ rows, total });
  } catch (err) { next(err); }
});

// POST /api/payroll/runs?home=X — create draft run
router.post('/runs', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const parsed = runBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    if (parsed.data.period_start >= parsed.data.period_end) {
      return res.status(400).json({ error: 'period_start must be before period_end' });
    }
    if (parsed.data.pay_date && parsed.data.pay_date < parsed.data.period_end) {
      return res.status(400).json({ error: 'pay_date cannot be before period_end' });
    }
    // Wrap check+create in a transaction to prevent TOCTOU: without this, two
    // concurrent requests can both pass the overlap check and create duplicate runs.
    const run = await withTransaction(async (client) => {
      const overlap = await payrollRunRepo.hasOverlap(req.home.id, parsed.data.period_start, parsed.data.period_end, client);
      if (overlap) return null;
      return payrollRunRepo.create(req.home.id, parsed.data, client);
    });
    if (!run) {
      return res.status(409).json({ error: 'A payroll run already exists that overlaps this period. Void the existing run first or adjust the dates.' });
    }
    await auditService.log('payroll_create', req.home.slug, req.user.username, { id: run.id, entity: 'run' });
    res.status(201).json(run);
  } catch (err) { next(err); }
});

// GET /api/payroll/runs/:runId?home=X — get run with lines
router.get('/runs/:runId', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read', { allowOwn: true }), async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    if (requireStaffLink(req, res, 'payroll')) return;
    const run   = await payrollRunRepo.findById(runIdP.data, req.home.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    let lines = await payrollRunRepo.findLinesByRun(runIdP.data, req.home.id);
    // staff_member: own payslip only, no aggregate totals
    if (isOwnDataOnly(req.homeRole, 'payroll')) {
      if (!OWN_DATA_PAYROLL_STATUSES.includes(run.status)) {
        return res.status(404).json({ error: 'Run not found' });
      }
      lines = lines.filter(l => l.staff_id === req.staffId);
      if (lines.length === 0) return res.status(404).json({ error: 'Run not found' });
      return res.json({ run: shapeOwnPayrollRunDetail(run), lines });
    }
    res.json({ run, lines });
  } catch (err) { next(err); }
});

// POST /api/payroll/runs/:runId/calculate?home=X — trigger calculation
router.post('/runs/:runId/calculate', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    await payrollService.calculateRun(runIdP.data, req.home.id, req.home.slug, req.user.username);
    const run   = await payrollRunRepo.findById(runIdP.data, req.home.id);
    const lines = await payrollRunRepo.findLinesByRun(runIdP.data, req.home.id);
    await auditService.log('payroll_update', req.home.slug, req.user.username, { id: runIdP.data, entity: 'run', action: 'calculate' });
    res.json({ run, lines });
  } catch (err) { next(err); }
});

// POST /api/payroll/runs/:runId/approve?home=X — approve run (blocks if NMW violations)
router.post('/runs/:runId/approve', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    await payrollService.approveRun(runIdP.data, req.home.id, req.home.slug, req.user.username);
    const run = await payrollRunRepo.findById(runIdP.data, req.home.id);
    await auditService.log('payroll_update', req.home.slug, req.user.username, { id: runIdP.data, entity: 'run', action: 'approve' });
    dispatchEvent(req.home.id, 'payroll_run.approved', { runId: runIdP.data, homeSlug: req.home.slug, approvedBy: req.user.username });
    res.json(run);
  } catch (err) { next(err); }
});

// POST /api/payroll/runs/:runId/void?home=X — void a run
// draft/calculated: simple status update
// approved/exported: reverses YTD and HMRC liability before voiding (see payrollService.voidApprovedRun)
// locked: not voidable
router.post('/runs/:runId/void', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    const rawV = parseInt(req.body._version, 10);
    const version = Number.isFinite(rawV) ? rawV : null;

    // Peek at the run status without locking to decide routing
    const peek = await payrollRunRepo.findById(runIdP.data, req.home.id);
    if (!peek) return res.status(404).json({ error: 'Run not found' });

    if (['approved', 'exported'].includes(peek.status)) {
      // Approved/exported: full reversal via service (handles YTD + HMRC in one transaction)
      const run = await payrollService.voidApprovedRun(
        runIdP.data, req.home.id, req.home.slug, req.user.username, version,
      );
      return res.json(run);
    }

    if (!['draft', 'calculated'].includes(peek.status)) {
      return res.status(400).json({
        error: `Cannot void a run with status "${peek.status}". Only draft, calculated, approved, or exported runs can be voided.`,
      });
    }

    // Draft/calculated: simple status transition, no YTD/HMRC to reverse
    const run = await withTransaction(async (client) => {
      const existing = await payrollRunRepo.findByIdForUpdate(runIdP.data, req.home.id, client);
      if (!existing) { const e = new Error('Run not found'); e.status = 404; throw e; }
      if (!['draft', 'calculated'].includes(existing.status)) {
        // Race: status changed between peek and lock — re-route to 400
        const e = new Error(`Run status changed to "${existing.status}". Please refresh and try again.`);
        e.status = 409; throw e;
      }
      const updated = await payrollRunRepo.updateStatus(runIdP.data, req.home.id, 'voided', null, client, existing.version);
      if (updated === null) { const e = new Error('Record was modified by another user. Please refresh and try again.'); e.status = 409; throw e; }
      return updated;
    });
    await auditService.log('payroll_void', req.home.slug, req.user.username, { id: runIdP.data, entity: 'run', action: 'void' });
    res.json(run);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// GET /api/payroll/runs/:runId/export?home=X&format=sage|xero|generic — CSV download
router.get('/runs/:runId/export', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    const format = ['sage', 'xero', 'generic'].includes(req.query.format)
      ? req.query.format
      : 'generic';
    const { csv, filename } = await payrollService.exportRunCSVReadOnly(
      runIdP.data, req.home.id, req.home.slug, req.user.username, format,
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', SENSITIVE_DOWNLOAD_CACHE_CONTROL);
    res.send(csv);
  } catch (err) { next(err); }
});

router.post('/runs/:runId/export', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    const format = ['sage', 'xero', 'generic'].includes(req.body?.format)
      ? req.body.format
      : 'generic';
    await payrollService.markRunExported(runIdP.data, req.home.id, req.home.slug, req.user.username, format);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/payroll/runs/:runId/payslips/:staffId?home=X — single payslip PDF
router.get('/runs/:runId/payslips/:staffId', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read', { allowOwn: true }), async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    const staffIdP = z.string().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/).safeParse(req.params.staffId);
    if (!staffIdP.success) return res.status(400).json({ error: 'Invalid staff ID' });
    const staffId = staffIdP.data;
    // staff_member can only access own payslip
    if (isOwnDataOnly(req.homeRole, 'payroll')) {
      if (!req.staffId) return res.status(403).json({ error: 'No staff link configured' });
      if (staffId !== req.staffId) return res.status(403).json({ error: 'Access denied — you can only view your own payslip' });
      const run = await payrollRunRepo.findById(runIdP.data, req.home.id);
      if (!run || !OWN_DATA_PAYROLL_STATUSES.includes(run.status)) {
        return res.status(404).json({ error: 'No payslip data found for this staff member' });
      }
    }
    const payslips = await payrollService.assemblePayslipData(runIdP.data, req.home.id, staffId);
    if (!payslips.length) return res.status(404).json({ error: 'No payslip data found for this staff member' });
    const pdf = generatePayslipPDF(payslips[0]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip_${staffId}_${payslips[0].run.period_start}.pdf"`);
    res.setHeader('Cache-Control', SENSITIVE_DOWNLOAD_CACHE_CONTROL);
    res.send(Buffer.from(pdf.output('arraybuffer')));
  } catch (err) { next(err); }
});

// GET /api/payroll/runs/:runId/payslips?home=X — bulk payslip data (JSON, frontend renders PDF)
router.get('/runs/:runId/payslips', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read', { allowOwn: true }), async (req, res, next) => {
  try {
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    if (requireStaffLink(req, res, 'payroll')) return;
    // staff_member: only own payslip
    const ownData = isOwnDataOnly(req.homeRole, 'payroll');
    if (ownData) {
      const run = await payrollRunRepo.findById(runIdP.data, req.home.id);
      if (!run || !OWN_DATA_PAYROLL_STATUSES.includes(run.status)) {
        return res.status(404).json({ error: 'No payslip data found for this staff member' });
      }
    }
    const staffFilter = ownData ? req.staffId : null;
    const payslips = await payrollService.assemblePayslipData(runIdP.data, req.home.id, staffFilter);
    if (ownData) {
      if (payslips.length === 0) return res.status(404).json({ error: 'No payslip data found for this staff member' });
      return res.json(payslips.map(shapeOwnPayslipData));
    }
    res.json(payslips);
  } catch (err) { next(err); }
});

// ── Agency ────────────────────────────────────────────────────────────────────

// GET /api/payroll/agency/providers?home=X
router.get('/agency/providers', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read'), async (req, res, next) => {
  try {
    if (blockOwnDataRole(req, res, 'payroll')) return;
    res.json(await agencyRepo.findProvidersByHome(req.home.id));
  } catch (err) { next(err); }
});

// POST /api/payroll/agency/providers?home=X
router.post('/agency/providers', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const parsed = providerBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const provider = await agencyRepo.createProvider(req.home.id, parsed.data);
    await auditService.log('payroll_create', req.home.slug, req.user.username, { id: provider.id, entity: 'agency_provider' });
    res.status(201).json(provider);
  } catch (err) { next(err); }
});

// PUT /api/payroll/agency/providers/:id?home=X
router.put('/agency/providers/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const idP = providerSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid provider ID' });
    const parsed = providerBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { _version, ...data } = parsed.data;
    if (_version == null) return res.status(400).json({ error: 'Version is required. Refresh and try again.' });
    const existing = await agencyRepo.findProviderById(idP.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Provider not found' });
    const provider = await agencyRepo.updateProvider(idP.data, req.home.id, data, null, _version);
    if (!provider) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    await auditService.log('payroll_update', req.home.slug, req.user.username, { id: idP.data, entity: 'agency_provider' });
    res.json(provider);
  } catch (err) { next(err); }
});

// GET /api/payroll/agency/shifts?home=X&start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/agency/shifts', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read'), async (req, res, next) => {
  try {
    if (blockOwnDataRole(req, res, 'payroll')) return;
    const startP = dateSchema.safeParse(req.query.start);
    const endP   = dateSchema.safeParse(req.query.end);
    if (!startP.success || !endP.success) return res.status(400).json({ error: 'start and end required' });
    res.json(await agencyRepo.findShiftsByHomePeriod(req.home.id, startP.data, endP.data));
  } catch (err) { next(err); }
});

// POST /api/payroll/agency/shifts?home=X
router.post('/agency/shifts', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const parsed = agencyShiftBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    if (!parsed.data.agency_attempt_id) {
      return res.status(400).json({ error: 'Agency approval attempt is required before logging agency' });
    }
    const shift = await withTransaction(async (client) => {
      const attempt = await agencyAttemptRepo.findByIdForUpdate(parsed.data.agency_attempt_id, req.home.id, client);
      const data = { ...parsed.data, total_cost: Math.round(parsed.data.hours * parsed.data.hourly_rate * 100) / 100 };
      const attemptError = agencyAttemptErrorForShift(attempt, data);
      if (attemptError) {
        throw Object.assign(new Error(attemptError), { status: 400 });
      }
      const created = await agencyRepo.createShift(req.home.id, data, client);
      const linked = await agencyAttemptRepo.linkAgencyShift(attempt.id, req.home.id, created.id, client);
      if (!linked) {
        throw Object.assign(new Error('Agency attempt could not be linked to shift'), { status: 409 });
      }
      return created;
    });
    await auditService.log('payroll_create', req.home.slug, req.user.username, {
      id: shift.id,
      entity: 'agency_shift',
      agency_attempt_id: shift.agency_attempt_id,
    });
    if (parsed.data.agency_attempt_id) {
      const attempt = await agencyAttemptRepo.findById(parsed.data.agency_attempt_id, req.home.id);
      if (attempt?.emergency_override) {
        await auditService.log('agency_shift_emergency_override', req.home.slug, req.user.username, {
          agency_shift_id: shift.id,
          agency_attempt_id: attempt.id,
        });
      }
    }
    res.status(201).json(shift);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    if (err.status === 409) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// PUT /api/payroll/agency/shifts/:id?home=X
router.put('/agency/shifts/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const idP = providerSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid shift ID' });
    const parsed = agencyShiftBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { _version, ...payload } = parsed.data;
    if (_version == null) return res.status(400).json({ error: 'Version is required. Refresh and try again.' });
    const existing = await agencyRepo.findShiftById(idP.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Shift not found' });
    const data = {
      ...payload,
      agency_attempt_id: payload.agency_attempt_id ?? existing.agency_attempt_id ?? null,
      total_cost: Math.round(payload.hours * payload.hourly_rate * 100) / 100,
    };
    const shift = await withTransaction(async (client) => {
      if (data.agency_attempt_id) {
        const attempt = await agencyAttemptRepo.findByIdForUpdate(data.agency_attempt_id, req.home.id, client);
        const attemptError = agencyAttemptErrorForShift(attempt, data, idP.data);
        if (attemptError) {
          throw Object.assign(new Error(attemptError), { status: 400 });
        }
      }
      const updated = await agencyRepo.updateShift(idP.data, req.home.id, data, client, _version);
      if (updated && data.agency_attempt_id) {
        if (existing.agency_attempt_id && existing.agency_attempt_id !== data.agency_attempt_id) {
          await agencyAttemptRepo.unlinkAgencyShift(existing.agency_attempt_id, req.home.id, updated.id, client);
        }
        const linked = await agencyAttemptRepo.linkAgencyShift(data.agency_attempt_id, req.home.id, updated.id, client);
        if (!linked) {
          throw Object.assign(new Error('Agency attempt could not be linked to shift'), { status: 409 });
        }
      }
      return updated;
    });
    if (!shift) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    await auditService.log('payroll_update', req.home.slug, req.user.username, { id: idP.data, entity: 'agency_shift' });
    res.json(shift);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    if (err.status === 409) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// GET /api/payroll/agency/metrics?home=X&weeks=12
router.get('/agency/metrics', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read'), async (req, res, next) => {
  try {
    if (blockOwnDataRole(req, res, 'payroll')) return;
    const rawWeeks = Number.parseInt(req.query.weeks, 10);
    const weeks = Math.min(52, Math.max(1, Number.isFinite(rawWeeks) ? rawWeeks : 12));
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
  source:            z.enum(['manual', 'p45', 'starter', 'hmrc', 'hmrc_notice']).optional().default('manual'),
  notes:             z.string().max(1000).nullable().optional(),
});

// GET /api/payroll/tax-codes?home=X
router.get('/tax-codes', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read', { allowOwn: true }), async (req, res, next) => {
  try {
    if (requireStaffLink(req, res, 'payroll')) return;
    let codes = await taxRepo.listTaxCodesByHome(req.home.id);
    if (isOwnDataOnly(req.homeRole, 'payroll')) {
      codes = codes.filter(c => c.staff_id === req.staffId);
    }
    res.json(codes);
  } catch (err) { next(err); }
});

// POST /api/payroll/tax-codes?home=X
router.post('/tax-codes', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const parsed = taxCodeBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    await assertPayrollStaffExists(req.home.id, parsed.data.staff_id);
    const payload = {
      ...parsed.data,
      source: parsed.data.source === 'hmrc_notice' ? 'hmrc' : parsed.data.source,
    };
    const result = await taxRepo.upsertTaxCode(req.home.id, payload);
    await auditService.log('payroll_create', req.home.slug, req.user.username, { id: result.id, entity: 'tax_code', staff_id: payload.staff_id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/payroll/ytd?home=X&staffId=X&year=X
router.get('/ytd', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read', { allowOwn: true }), async (req, res, next) => {
  try {
    const year = z.coerce.number().int().min(2020).safeParse(req.query.year);
    if (!year.success) return res.status(400).json({ error: 'year is required' });
    if (requireStaffLink(req, res, 'payroll')) return;
    // staff_member: force own staffId
    let sid;
    if (isOwnDataOnly(req.homeRole, 'payroll')) {
      sid = req.staffId;
    } else {
      const staffIdP = z.string().min(1).max(20).safeParse(req.query.staffId);
      if (!staffIdP.success) return res.status(400).json({ error: 'staffId is required' });
      sid = staffIdP.data;
    }
    const ytd = await taxRepo.getYTD(req.home.id, sid, year.data);
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
  contribution_override_employee: z.number().min(0).max(1).nullable().optional(),
  contribution_override_employer: z.number().min(0).max(1).nullable().optional(),
  notes:             z.string().max(1000).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.status === 'postponed' && !data.postponed_until) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['postponed_until'],
      message: 'postponed_until is required when status is postponed',
    });
  }
});

// GET /api/payroll/pensions?home=X
router.get('/pensions', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read', { allowOwn: true }), async (req, res, next) => {
  try {
    if (requireStaffLink(req, res, 'payroll')) return;
    let enrolments = await pensionRepo.listEnrolmentsByHome(req.home.id);
    if (isOwnDataOnly(req.homeRole, 'payroll')) {
      enrolments = enrolments.filter(e => e.staff_id === req.staffId);
    }
    res.json(enrolments);
  } catch (err) { next(err); }
});

// POST /api/payroll/pensions?home=X
router.post('/pensions', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const parsed = enrolmentBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    await assertPayrollStaffExists(req.home.id, parsed.data.staff_id);
    const payload = {
      ...parsed.data,
      postponed_until: parsed.data.status === 'postponed' ? parsed.data.postponed_until || null : null,
      reassessment_date: parsed.data.status === 'opted_out' ? parsed.data.reassessment_date || null : null,
    };
    const result = await pensionRepo.upsertEnrolment(req.home.id, payload);
    await auditService.log('payroll_create', req.home.slug, req.user.username, { id: result.id, entity: 'pension_enrolment', staff_id: payload.staff_id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/payroll/pension-config
router.get('/pension-config', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read'), async (req, res, next) => {
  try {
    if (blockOwnDataRole(req, res, 'payroll')) return;
    const today = todayLocalISO();
    const config = await pensionRepo.getPensionConfig(today);
    res.json(config || {});
  } catch (err) { next(err); }
});

// ── Phase 2: SSP & Sick Periods ───────────────────────────────────────────────

// GET /api/payroll/ssp-config
router.get('/ssp-config', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read'), async (req, res, next) => {
  try {
    if (blockOwnDataRole(req, res, 'payroll')) return;
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
  _version:          z.number().int().positive().optional(),
});

// GET /api/payroll/sick-periods?home=X[&staffId=X]
router.get('/sick-periods', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read', { allowOwn: true }), async (req, res, next) => {
  try {
    if (requireStaffLink(req, res, 'payroll')) return;
    // staff_member: force own staffId
    const staffId = isOwnDataOnly(req.homeRole, 'payroll')
      ? req.staffId
      : safeStr(req.query.staffId, 20);
    res.json(await sspRepo.listSickPeriods(req.home.id, staffId));
  } catch (err) { next(err); }
});

// POST /api/payroll/sick-periods?home=X
router.post('/sick-periods', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const parsed = sickPeriodBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await withTransaction(async (client) => {
      await assertPayrollStaffExists(req.home.id, parsed.data.staff_id, client);
      if (parsed.data.end_date && parsed.data.end_date < parsed.data.start_date) {
        throw new ValidationError('end_date cannot be before start_date');
      }
      const linked = await resolveLinkedSickPeriod(
        req.home.id,
        parsed.data.staff_id,
        parsed.data.start_date,
        parsed.data.linked_to_period_id || null,
        client,
      );
      await assertNoSickPeriodOverlap(
        req.home.id,
        parsed.data.staff_id,
        parsed.data.start_date,
        parsed.data.end_date || null,
        null,
        client,
      );
      return sspRepo.createSickPeriod(req.home.id, {
        ...parsed.data,
        linked_to_period_id: linked?.id || null,
        waiting_days_served: linked ? (linked.waiting_days_served || 0) : (parsed.data.waiting_days_served ?? 0),
      }, client);
    });
    await auditService.log('payroll_create', req.home.slug, req.user.username, { id: result.id, entity: 'sick_period', staff_id: parsed.data.staff_id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PUT /api/payroll/sick-periods/:id?home=X
router.put('/sick-periods/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const idP = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid period ID' });
    const parsed = sickPeriodUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { _version, ...changes } = parsed.data;
    const result = await withTransaction(async (client) => {
      const existing = await sspRepo.findSickPeriodById(idP.data, req.home.id, client);
      if (!existing) return { kind: 'missing' };
      const nextEndDate = Object.prototype.hasOwnProperty.call(changes, 'end_date')
        ? changes.end_date
        : existing.end_date;
      if (nextEndDate && nextEndDate < existing.start_date) {
        throw new ValidationError('end_date cannot be before start_date');
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'end_date')) {
        await assertNoSickPeriodOverlap(
          req.home.id,
          existing.staff_id,
          existing.start_date,
          nextEndDate || null,
          idP.data,
          client,
        );
      }
      const updated = await sspRepo.updateSickPeriod(idP.data, req.home.id, changes, client, _version ?? null);
      if (!updated) return { kind: _version != null ? 'stale' : 'missing' };
      return { kind: 'updated', updated };
    });
    if (result.kind === 'missing') return res.status(404).json({ error: 'Sick period not found' });
    if (result.kind === 'stale') {
      return res.status(409).json({ error: 'Sick period was updated by someone else. Refresh and try again.' });
    }
    const updated = result.updated;
    await auditService.log('payroll_update', req.home.slug, req.user.username, { id: idP.data, entity: 'sick_period' });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Phase 2: HMRC Liability Tracker ──────────────────────────────────────────

const markPaidSchema = z.object({
  paid_date:      dateSchema,
  paid_reference: z.string().max(100).nullable().optional(),
});

// GET /api/payroll/hmrc?home=X&year=X
router.get('/hmrc', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read'), async (req, res, next) => {
  try {
    if (blockOwnDataRole(req, res, 'payroll')) return;
    const year = z.coerce.number().int().min(2020).safeParse(req.query.year);
    if (!year.success) return res.status(400).json({ error: 'year is required' });
    // Refresh overdue status before returning
    await hmrcRepo.refreshOverdueStatus(req.home.id);
    res.json(await hmrcRepo.listLiabilities(req.home.id, year.data));
  } catch (err) { next(err); }
});

// PUT /api/payroll/hmrc/:id/paid?home=X
router.put('/hmrc/:id/paid', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const idP = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid liability ID' });
    const parsed = markPaidSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const updated = await hmrcRepo.markPaid(idP.data, req.home.id, parsed.data.paid_date, parsed.data.paid_reference);
    if (!updated) return res.status(404).json({ error: 'Liability not found' });
    await auditService.log('payroll_update', req.home.slug, req.user.username, { id: idP.data, entity: 'hmrc_liability', action: 'mark_paid' });
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/payroll/runs/:runId/summary-pdf?home=X — payroll summary PDF for accountant
// Admin only, approved/exported/locked runs only
router.get('/runs/:runId/summary-pdf', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read'), async (req, res, next) => {
  try {
    if (blockOwnDataRole(req, res, 'payroll')) return;
    const runIdP = runIdSchema.safeParse(req.params.runId);
    if (!runIdP.success) return res.status(400).json({ error: 'Invalid run ID' });
    const run = await payrollRunRepo.findById(runIdP.data, req.home.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (!['approved', 'exported', 'locked'].includes(run.status)) {
      return res.status(400).json({ error: 'Summary PDF only available for approved runs' });
    }
    const lines = await payrollRunRepo.findLinesByRun(runIdP.data, req.home.id);
    const doc = generateSummaryPDF(run, lines, { name: req.home.config?.home_name || req.home.name });
    const buffer = Buffer.from(doc.output('arraybuffer'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="payroll_summary_${run.period_start}_${run.period_end}.pdf"`,
    );
    res.setHeader('Cache-Control', SENSITIVE_DOWNLOAD_CACHE_CONTROL);
    res.send(buffer);
  } catch (err) { next(err); }
});

export default router;
