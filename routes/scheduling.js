import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db.js';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as dayNoteRepo from '../repositories/dayNoteRepo.js';
import * as trainingRepo from '../repositories/trainingRepo.js';
import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as auditRepo from '../repositories/auditRepo.js';
import { dispatchEvent } from '../services/webhookService.js';
import { AppError } from '../errors.js';
import {
  getCycleDay, getScheduledShift, isOTShift, isAgencyShift,
  getLeaveYear, getALDeductionHours, STATUTORY_WEEKS,
} from '../shared/rotation.js';
import { isOwnDataOnly } from '../shared/roles.js';
import { addDaysLocalISO, todayLocalISO } from '../lib/dateOnly.js';

const router = Router();

/**
 * Validate an AL override before allowing it.
 * Checks max_al_same_day and per-staff entitlement (hours-based).
 * @param {number} homeId
 * @param {object} config
 * @param {string} date   "YYYY-MM-DD"
 * @param {string} staffId
 * @param {object} [batchCtx]  In-batch counters for bulk validation:
 *   { dayAL: { "YYYY-MM-DD": number }, staffAL: { staffId: number }, staffALHours: { staffId: number } }
 * @param {object} [client]  Optional pg client for transaction
 * @returns {{ error: string|null, al_hours: number }} validation result with computed hours
 */
async function validateALOverride(homeId, config, date, staffId, batchCtx, client) {
  const conn = client || pool;

  if (client) {
    await conn.query(
      'SELECT pg_advisory_xact_lock($1::integer, hashtext($2))',
      [homeId, date]
    );
  }

  // 1. Check max AL per day (excluding this staff's existing override on this date)
  const maxAL = config?.max_al_same_day ?? 2;
  const { rows: countRows } = await conn.query(
    `SELECT COUNT(*)::int AS cnt FROM shift_overrides
     WHERE home_id = $1 AND date = $2 AND shift = 'AL' AND staff_id != $3`,
    [homeId, date, staffId]
  );
  const dayCount = countRows[0].cnt + (batchCtx?.dayAL?.[date] ?? 0);
  if (dayCount >= maxAL) {
    return { error: `Max AL per day (${maxAL}) already reached on ${date}`, al_hours: 0 };
  }

  // 2. Get staff record
  const { rows: staffRows } = await conn.query(
    `SELECT al_entitlement, al_carryover, contract_hours, team, pref, start_date FROM staff WHERE home_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [homeId, staffId]
  );
  if (staffRows.length === 0) return { error: null, al_hours: 0 }; // agency/unknown — skip
  const staff = staffRows[0];

  // 3. Require contract_hours for AL booking
  const contractHours = parseFloat(staff.contract_hours) || 0;
  if (contractHours <= 0) {
    return { error: `Cannot book AL — contract hours not set for this staff member`, al_hours: 0 };
  }

  // 4. Reject AL on scheduled OFF days
  const cycleDay = getCycleDay(date, config.cycle_start_date);
  const staffObj = { id: staffId, team: staff.team, pref: staff.pref, start_date: staff.start_date, contract_hours: contractHours };
  const scheduled = getScheduledShift(staffObj, cycleDay, date);
  if (scheduled === 'OFF') {
    return { error: `Cannot book AL on a scheduled OFF day (${date})`, al_hours: 0 };
  }

  // 5. Compute al_hours for this booking
  const alHoursForThisDay = getALDeductionHours(staffObj, date, config);

  // 6. Check entitlement in hours
  const leaveYear = getLeaveYear(date, config?.leave_year_start);
  const annualEntitlement = staff.al_entitlement != null
    ? parseFloat(staff.al_entitlement)
    : STATUTORY_WEEKS * contractHours;
  const carryover = parseFloat(staff.al_carryover) || 0;
  const totalEntitlement = annualEntitlement + carryover;

  // Sum hours already used in leave year, excluding the current date being upserted
  // (prevents double-counting when editing an existing AL booking on the same date)
  const { rows: alRows } = await conn.query(
    `SELECT COALESCE(SUM(al_hours), 0)::numeric AS total_hours,
            ARRAY_AGG(date::text) FILTER (WHERE al_hours IS NULL) AS null_dates
     FROM shift_overrides
     WHERE home_id = $1 AND staff_id = $2 AND shift = 'AL'
       AND date >= $3 AND date <= $4
       AND date != $5`,
    [homeId, staffId, leaveYear.startStr, leaveYear.endStr, date]
  );
  let hoursUsed = parseFloat(alRows[0].total_hours) || 0;
  // Legacy bookings without al_hours: derive from scheduled shift (matches frontend)
  const nullDates = alRows[0].null_dates;
  if (nullDates) {
    for (const d of nullDates) {
      hoursUsed += getALDeductionHours(staffObj, d, config);
    }
  }
  // Add in-batch accumulated hours
  hoursUsed += (batchCtx?.staffALHours?.[staffId] ?? 0);

  if (hoursUsed + alHoursForThisDay > totalEntitlement) {
    return {
      error: `Staff has used ${hoursUsed.toFixed(1)}h of ${totalEntitlement.toFixed(1)}h AL entitlement — cannot deduct ${alHoursForThisDay}h`,
      al_hours: alHoursForThisDay,
    };
  }

  return { error: null, al_hours: alHoursForThisDay };
}

const VALID_SHIFTS = [
  'E', 'L', 'EL', 'N', 'OFF', 'AL', 'SICK', 'NS', 'ADM', 'TRN', 'AVL',
  'OC-E', 'OC-L', 'OC-EL', 'OC-N',
  'AG-E', 'AG-L', 'AG-EL', 'AG-N',
  'BH-D', 'BH-N',
];
const shiftSchema = z.enum(VALID_SHIFTS);
const isoDateOnlyRe = /^\d{4}-\d{2}-\d{2}$/;
const strictDateSchema = z.string().regex(isoDateOnlyRe).refine(isValidIsoDateOnly, { message: 'Invalid date' });

// Shifts that require care staff to have valid mandatory training
const WORKING_SHIFTS_FOR_TRAINING_CHECK = new Set([
  'E', 'L', 'EL', 'N',
  'OC-E', 'OC-L', 'OC-EL', 'OC-N',
  'AG-E', 'AG-L', 'AG-EL', 'AG-N',
  'BH-D', 'BH-N',
]);
const TRAINING_BLOCKING_CARE_ROLES = new Set([
  'Senior Carer', 'Carer', 'Team Lead', 'Night Senior', 'Night Carer', 'Float Senior', 'Float Carer',
]);
const BLOCKING_TRAINING_TYPE_IDS = ['fire-safety', 'moving-handling', 'safeguarding-adults'];

function getTodayStr() {
  return todayLocalISO();
}

function isValidIsoDateOnly(value) {
  if (!isoDateOnlyRe.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function assertEditLock(req, config, dates) {
  const expectedPin = String(config?.edit_lock_pin || '');
  if (!expectedPin) return;

  const lockedDates = [...new Set(dates.filter(date => date < getTodayStr()))];
  if (lockedDates.length === 0) return;

  if (String(req.get('X-Edit-Lock-Pin') || '') === expectedPin) return;

  const message = lockedDates.length === 1
    ? `Past date ${lockedDates[0]} is locked — enter the edit PIN to continue`
    : 'Past dates are locked — enter the edit PIN to continue';
  throw new AppError(message, 423, 'SCHEDULING_EDIT_LOCKED');
}

function buildSchedulingConfigOut(config, { ownDataOnly = false } = {}) {
  const baseConfig = { ...(config || {}) };
  const editLockEnabled = Boolean(baseConfig.edit_lock_pin);
  delete baseConfig.edit_lock_pin;

  if (ownDataOnly) {
    delete baseConfig.agency_rate_day;
    delete baseConfig.agency_rate_night;
    delete baseConfig.ot_premium;
    delete baseConfig.bh_premium_multiplier;
  }

  return {
    ...baseConfig,
    edit_lock_enabled: editLockEnabled,
  };
}

/**
 * Check whether a working shift assignment is blocked by expired / missing mandatory training.
 * Returns a warning string if a blocking type is expired or not started, null if compliant.
 *
 * Only fires for care staff roles and working shifts. Does NOT block the save itself —
 * the caller decides whether to 400 (enforce_training_blocking) or 200+warnings.
 *
 * Uses one DB query: joins staff + training_records for the 3 blocking types.
 */
async function checkTrainingBlockingForOverride(homeId, staffId, shift, config, effectiveDate, client) {
  if (!WORKING_SHIFTS_FOR_TRAINING_CHECK.has(shift)) return null;
  const trainingTypes = config?.training_types;
  if (!trainingTypes?.length) return null;

  const conn = client || pool;
  const effectiveDateStr = effectiveDate || getTodayStr();

  // Get staff role/name + latest expiry per blocking type in a single query.
  // NULL expiry (never-expiring training) is mapped to '9999-12-31' so it never triggers blocking.
  const { rows } = await conn.query(
    `SELECT s.role, s.name,
            tr.training_type_id,
            MAX(CASE WHEN tr.expiry IS NULL THEN '9999-12-31' ELSE tr.expiry::text END) AS latest_expiry
     FROM staff s
     LEFT JOIN training_records tr
       ON tr.staff_id = s.id AND tr.home_id = s.home_id
       AND tr.training_type_id = ANY($3) AND tr.deleted_at IS NULL
       AND tr.completed IS NOT NULL
     WHERE s.home_id = $1 AND s.id = $2 AND s.deleted_at IS NULL
     GROUP BY s.role, s.name, tr.training_type_id`,
    [homeId, staffId, BLOCKING_TRAINING_TYPE_IDS],
  );

  if (!rows.length) return null; // unknown/agency staff — skip
  const { role, name } = rows[0];
  if (!TRAINING_BLOCKING_CARE_ROLES.has(role)) return null;

  // Map typeId → latest_expiry (only for rows with an actual training_type_id)
  const expiryMap = new Map(
    rows.filter(r => r.training_type_id).map(r => [r.training_type_id, r.latest_expiry]),
  );

  const blocked = [];
  for (const typeId of BLOCKING_TRAINING_TYPE_IDS) {
    const t = trainingTypes.find(tt => tt.id === typeId && tt.active !== false);
    if (!t) continue; // type not configured for this home
    if (t.roles && !t.roles.includes(role)) continue; // doesn't apply to this role
    const expiry = expiryMap.get(typeId);
    if (!expiry || expiry < effectiveDateStr) blocked.push(t.name || typeId);
  }

  if (!blocked.length) return null;
  return `${name}: expired or missing critical training: ${blocked.join(', ')}`;
}

// GET /api/scheduling?home=X — full scheduling bundle
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'read', { allowOwn: true }), async (req, res, next) => {
  try {
    // Default ±90-day rolling window; callers may widen with ?from=&to= query params (max 400 days).
    const now = new Date();
    const requestedFrom = typeof req.query.from === 'string' ? req.query.from : null;
    const requestedTo = typeof req.query.to === 'string' ? req.query.to : null;
    if (requestedFrom && !isValidIsoDateOnly(requestedFrom)) {
      return res.status(400).json({ error: 'Invalid from date' });
    }
    if (requestedTo && !isValidIsoDateOnly(requestedTo)) {
      return res.status(400).json({ error: 'Invalid to date' });
    }
    const today = todayLocalISO(now);
    const fromDate = requestedFrom || addDaysLocalISO(today, -90);
    const toDate = requestedTo || addDaysLocalISO(today, 90);
    // Cap range to 400 days to prevent unbounded queries
    const daySpan = (new Date(toDate) - new Date(fromDate)) / 86400000;
    if (daySpan < 0 || daySpan > 400) {
      return res.status(400).json({ error: 'Date range must be 0–400 days' });
    }

    const [staffResult, overrides, dayNotes, trainingResult, onboarding] = await Promise.all([
      staffRepo.findByHome(req.home.id),
      overrideRepo.findByHome(req.home.id, fromDate, toDate),
      dayNoteRepo.findByHome(req.home.id, fromDate, toDate),
      trainingRepo.findByHome(req.home.id),
      onboardingRepo.findByHome(req.home.id),
    ]);
    const staff = staffResult.rows;
    const training = trainingResult.rows;

    // Strip PII for non-admin users — only expose scheduling-relevant fields
    let staffOut, onboardingOut, overridesOut = overrides, trainingOut = training;
    if (req.homeRole !== 'home_manager' && req.homeRole !== 'deputy_manager') {
      staffOut = staff.map(({ id, name, role, team, pref, skill, active, start_date, contract_hours, wtr_opt_out, al_entitlement, al_carryover, leaving_date }) =>
        ({ id, name, role, team, pref, skill, active, start_date, contract_hours, wtr_opt_out, al_entitlement, al_carryover, leaving_date }));
      onboardingOut = undefined;
    } else {
      staffOut = staff;
      onboardingOut = onboarding;
    }

    // staff_member own-data: minimal staff fields, own overrides only, no training/onboarding
    let configOut = buildSchedulingConfigOut(req.home.config);
    if (isOwnDataOnly(req.homeRole, 'scheduling')) {
      if (!req.staffId) return res.status(403).json({ error: 'No staff link configured — contact your home manager' });
      staffOut = staff
        .filter(({ id }) => id === req.staffId)
        .map(({ id, name, role, team, active }) => ({ id, name, role, team, active }));
      overridesOut = {};
      for (const [date, entries] of Object.entries(overrides)) {
        if (entries[req.staffId]) overridesOut[date] = { [req.staffId]: entries[req.staffId] };
      }
      trainingOut = [];
      onboardingOut = undefined;
      // Strip commercially sensitive fields — staff don't need cost parameters
      configOut = buildSchedulingConfigOut(req.home.config, { ownDataOnly: true });
    }

    res.json({
      config: configOut,
      configUpdatedAt: req.home.updated_at ? req.home.updated_at.toISOString() : null,
      staff: staffOut,
      overrides: overridesOut,
      day_notes: dayNotes,
      training: trainingOut,
      ...(onboardingOut !== undefined && { onboarding: onboardingOut }),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/scheduling/overrides?home=X — upsert single override
const overrideBodySchema = z.object({
  date:     strictDateSchema,
  staffId:  z.string().min(1).max(40),
  shift:    shiftSchema,
  reason:   z.string().max(200).optional(),
  source:   z.string().max(30).optional(),
  sleep_in: z.boolean().optional(),
  replaces_staff_id: z.string().min(1).max(40).optional(),
  override_hours: z.number().min(0).max(24).optional(),
  al_hours: z.number().min(0).max(24).optional(),
});

router.put('/overrides', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'write'), async (req, res, next) => {
  try {
    const parsed = overrideBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { date, staffId, shift, reason, source, sleep_in, replaces_staff_id, override_hours } = parsed.data;
    assertEditLock(req, req.home.config, [date]);

    // Validate replaces_staff_id constraints
    if (replaces_staff_id) {
      if (replaces_staff_id === staffId) {
        return res.status(400).json({ error: 'Staff cannot cover themselves' });
      }
      if (!isOTShift(shift) && !isAgencyShift(shift)) {
        return res.status(400).json({ error: 'Cover link only valid for OC/AG shifts' });
      }
    }

    let trainingWarning = null;
    if (shift === 'AL') {
      // Validate + upsert in a single transaction to prevent concurrent overbooking
      await withTransaction(async (client) => {
        const result = await validateALOverride(req.home.id, req.home.config, date, staffId, null, client);
        if (result.error) {
          const err = new Error(result.error);
          err.isALValidation = true;
          throw err;
        }
        // Backend computes al_hours — overrides any frontend hint
        await overrideRepo.upsertOne(req.home.id, date, staffId, {
          shift, reason, source, sleep_in, replaces_staff_id, override_hours,
          al_hours: result.al_hours,
        }, client);
        await auditRepo.log('override_upsert', req.home.slug, req.user.username, {
          date, staffId, shift,
          ...(replaces_staff_id && { replaces_staff_id }),
          al_hours: result.al_hours,
        }, client);
      });
    } else {
      // Non-AL shifts: training check + upsert in one transaction (prevents TOCTOU)
      await withTransaction(async (client) => {
        trainingWarning = await checkTrainingBlockingForOverride(req.home.id, staffId, shift, req.home.config, date, client);
        if (trainingWarning && req.home.config?.enforce_training_blocking) {
          const err = new Error(trainingWarning);
          err.isTrainingBlock = true;
          throw err;
        }
        await overrideRepo.upsertOne(req.home.id, date, staffId, {
          shift, reason, source, sleep_in, replaces_staff_id, override_hours, al_hours: null,
        }, client);
        await auditRepo.log('override_upsert', req.home.slug, req.user.username, {
          date, staffId, shift,
          ...(replaces_staff_id && { replaces_staff_id }),
        }, client);
      });
    }
    dispatchEvent(req.home.id, 'override.created', { date, staffId, shift });
    res.json(trainingWarning ? { ok: true, warnings: [trainingWarning] } : { ok: true });
  } catch (err) {
    if (err.isALValidation) return res.status(400).json({ error: err.message });
    if (err.isTrainingBlock) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// DELETE /api/scheduling/overrides?home=X&date=YYYY-MM-DD&staffId=X — delete single override
const overrideDeleteSchema = z.object({
  home:    z.string().max(100).regex(/^[a-zA-Z0-9_-]+$/),
  date:    strictDateSchema,
  staffId: z.string().min(1).max(40),
});

router.delete('/overrides', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'write'), async (req, res, next) => {
  try {
    const parsed = overrideDeleteSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    assertEditLock(req, req.home.config, [parsed.data.date]);
    await withTransaction(async (client) => {
      await overrideRepo.deleteOne(req.home.id, parsed.data.date, parsed.data.staffId, client);
      await auditRepo.log('override_delete', req.home.slug, req.user.username, {
        date: parsed.data.date,
        staffId: parsed.data.staffId,
      }, client);
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/scheduling/overrides/bulk?home=X — bulk upsert
const bulkBodySchema = z.object({
  overrides: z.array(z.object({
    date:     strictDateSchema,
    staffId:  z.string().min(1).max(40),
    shift:    shiftSchema,
    reason:   z.string().max(200).optional(),
    source:   z.string().max(30).optional(),
    sleep_in: z.boolean().optional(),
    replaces_staff_id: z.string().min(1).max(40).optional(),
    override_hours: z.number().min(0).max(24).optional(),
    al_hours: z.number().min(0).max(24).optional(),
  })).min(1).max(500),
});

router.post('/overrides/bulk', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'write'), async (req, res, next) => {
  try {
    const parsed = bulkBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    assertEditLock(req, req.home.config, parsed.data.overrides.map(o => o.date));

    // Validate replaces_staff_id constraints on all rows before opening DB transaction
    for (const o of parsed.data.overrides) {
      if (o.replaces_staff_id) {
        if (o.replaces_staff_id === o.staffId) {
          return res.status(400).json({ error: `Staff ${o.staffId} cannot cover themselves on ${o.date}` });
        }
        if (!isOTShift(o.shift) && !isAgencyShift(o.shift)) {
          return res.status(400).json({ error: `Cover link only valid for OC/AG shifts (${o.date} / ${o.staffId})` });
        }
      }
    }

    // Validate + upsert in a single transaction (atomicity, batch-aware AL counts, training TOCTOU fix)
    const overrides = parsed.data.overrides;
    const trainingWarnings = [];
    await withTransaction(async (client) => {
      // Training-blocking check inside transaction (prevents TOCTOU between check and write)
      for (const o of overrides) {
        if (!WORKING_SHIFTS_FOR_TRAINING_CHECK.has(o.shift)) continue;
        const w = await checkTrainingBlockingForOverride(req.home.id, o.staffId, o.shift, req.home.config, o.date, client);
        if (w) {
          if (req.home.config?.enforce_training_blocking) {
            const err = new Error(w);
            err.isTrainingBlock = true;
            throw err;
          }
          // Deduplicate — same staff member may appear multiple times in a bulk fill
          if (!trainingWarnings.includes(w)) trainingWarnings.push(w);
        }
      }

      const alOverrides = overrides.filter(o => o.shift === 'AL');
      if (alOverrides.length > 0) {
        const batchCtx = { dayAL: {}, staffALHours: {} };
        for (const o of alOverrides) {
          const result = await validateALOverride(req.home.id, req.home.config, o.date, o.staffId, batchCtx, client);
          if (result.error) {
            const err = new Error(result.error);
            err.isALValidation = true;
            throw err;
          }
          // Backend computes al_hours — override frontend hint
          o.al_hours = result.al_hours;
          // Track in-batch counts so subsequent items see accumulated state
          batchCtx.dayAL[o.date] = (batchCtx.dayAL[o.date] ?? 0) + 1;
          batchCtx.staffALHours[o.staffId] = (batchCtx.staffALHours[o.staffId] ?? 0) + result.al_hours;
        }
      }
      // Non-AL overrides: ensure al_hours is null
      for (const o of overrides) {
        if (o.shift !== 'AL') o.al_hours = null;
      }
      await overrideRepo.upsertBulk(req.home.id, overrides, client);
      const alCount = overrides.filter(o => o.shift === 'AL').length;
      const totalALHours = overrides.reduce((sum, o) => sum + (o.shift === 'AL' ? (o.al_hours ?? 0) : 0), 0);
      await auditRepo.log('override_bulk_upsert', req.home.slug, req.user.username, {
        count: parsed.data.overrides.length,
        ...(alCount > 0 && { al_count: alCount, al_hours_total: totalALHours }),
      }, client);
    });
    res.json({
      ok: true,
      count: parsed.data.overrides.length,
      ...(trainingWarnings.length > 0 && { warnings: trainingWarnings }),
    });
  } catch (err) {
    if (err.isALValidation) return res.status(400).json({ error: err.message });
    if (err.isTrainingBlock) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// DELETE /api/scheduling/overrides/month?home=X&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD — delete range
const monthDeleteSchema = z.object({
  home:     z.string().max(100).regex(/^[a-zA-Z0-9_-]+$/),
  fromDate: strictDateSchema,
  toDate:   strictDateSchema,
});

router.delete('/overrides/month', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'write'), async (req, res, next) => {
  try {
    const parsed = monthDeleteSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { fromDate, toDate } = parsed.data;
    if (fromDate > toDate) return res.status(400).json({ error: 'fromDate must be <= toDate' });
    // Prevent accidental full wipe — max 366 days
    const from = new Date(fromDate), to = new Date(toDate);
    if ((to - from) / 86400000 > 366) return res.status(400).json({ error: 'Date range exceeds 366 days' });
    assertEditLock(req, req.home.config, [fromDate]);
    const deleted = await withTransaction(async (client) => {
      const rowCount = await overrideRepo.deleteForDateRange(req.home.id, fromDate, toDate, client);
      await auditRepo.log('override_month_revert', req.home.slug, req.user.username, {
        fromDate,
        toDate,
        deleted: rowCount,
      }, client);
      return rowCount;
    });
    res.json({ ok: true, deleted });
  } catch (err) {
    next(err);
  }
});

// PUT /api/scheduling/day-notes?home=X — upsert or delete a day note
const dayNoteSchema = z.object({
  date: strictDateSchema,
  note: z.string().max(5000),
});

router.put('/day-notes', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'write'), async (req, res, next) => {
  try {
    const parsed = dayNoteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { date, note } = parsed.data;
    assertEditLock(req, req.home.config, [date]);
    await withTransaction(async (client) => {
      if (note.trim() === '') {
        await dayNoteRepo.deleteOne(req.home.id, date, client);
        await auditRepo.log('day_note_delete', req.home.slug, req.user.username, { date }, client);
      } else {
        await dayNoteRepo.upsertOne(req.home.id, date, note, client);
        await auditRepo.log('day_note_upsert', req.home.slug, req.user.username, { date }, client);
      }
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
