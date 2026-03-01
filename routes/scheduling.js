import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db.js';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as dayNoteRepo from '../repositories/dayNoteRepo.js';
import * as trainingRepo from '../repositories/trainingRepo.js';
import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as auditService from '../services/auditService.js';
import { getCycleDay, getScheduledShift, isOTShift, isAgencyShift } from '../shared/rotation.js';

const router = Router();

/**
 * Validate an AL override before allowing it.
 * Checks max_al_same_day and per-staff entitlement.
 * @param {number} homeId
 * @param {object} config
 * @param {string} date   "YYYY-MM-DD"
 * @param {string} staffId
 * @param {object} [batchCtx]  In-batch counters for bulk validation:
 *   { dayAL: { "YYYY-MM-DD": number }, staffAL: { staffId: number } }
 * @param {object} [client]  Optional pg client for transaction
 * @returns {string|null} error message or null if valid
 */
async function validateALOverride(homeId, config, date, staffId, batchCtx, client) {
  const conn = client || pool;

  // 1. Check max AL per day (excluding this staff's existing override on this date)
  const maxAL = config?.max_al_same_day ?? 2;
  const { rows: countRows } = await conn.query(
    `SELECT COUNT(*)::int AS cnt FROM shift_overrides
     WHERE home_id = $1 AND date = $2 AND shift = 'AL' AND staff_id != $3`,
    [homeId, date, staffId]
  );
  const dayCount = countRows[0].cnt + (batchCtx?.dayAL?.[date] ?? 0);
  if (dayCount >= maxAL) {
    return `Max AL per day (${maxAL}) already reached on ${date}`;
  }

  // 2. Check staff entitlement in current leave year
  const leaveYearStart = config?.leave_year_start || '04-01';
  const [lyMM, lyDD] = leaveYearStart.split('-').map(Number);
  const now = new Date();
  const thisYearBoundary = new Date(Date.UTC(now.getUTCFullYear(), lyMM - 1, lyDD));
  let lyStartStr, lyEndStr;
  if (now >= thisYearBoundary) {
    lyStartStr = thisYearBoundary.toISOString().slice(0, 10);
    const nextBoundary = new Date(Date.UTC(now.getUTCFullYear() + 1, lyMM - 1, lyDD));
    nextBoundary.setUTCDate(nextBoundary.getUTCDate() - 1);
    lyEndStr = nextBoundary.toISOString().slice(0, 10);
  } else {
    const prevBoundary = new Date(Date.UTC(now.getUTCFullYear() - 1, lyMM - 1, lyDD));
    lyStartStr = prevBoundary.toISOString().slice(0, 10);
    const endBoundary = new Date(thisYearBoundary);
    endBoundary.setUTCDate(endBoundary.getUTCDate() - 1);
    lyEndStr = endBoundary.toISOString().slice(0, 10);
  }

  // Count existing AL for this staff in the leave year
  const { rows: alRows } = await conn.query(
    `SELECT COUNT(*)::int AS cnt FROM shift_overrides
     WHERE home_id = $1 AND staff_id = $2 AND shift = 'AL'
       AND date >= $3 AND date <= $4`,
    [homeId, staffId, lyStartStr, lyEndStr]
  );
  const alUsed = alRows[0].cnt + (batchCtx?.staffAL?.[staffId] ?? 0);

  // Get staff entitlement
  const { rows: staffRows } = await conn.query(
    `SELECT al_entitlement, al_carryover, team, pref, start_date FROM staff WHERE home_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [homeId, staffId]
  );
  if (staffRows.length === 0) return null; // agency/unknown staff — skip entitlement check
  const staff = staffRows[0];

  // Reject AL on scheduled OFF days — only working days should use entitlement
  const cycleDay = getCycleDay(date, config.cycle_start_date);
  const staffObj = { id: staffId, team: staff.team, pref: staff.pref, start_date: staff.start_date };
  const scheduled = getScheduledShift(staffObj, cycleDay, date);
  if (scheduled === 'OFF') {
    return `Cannot book AL on a scheduled OFF day (${date})`;
  }
  const base = staff.al_entitlement != null ? staff.al_entitlement : (config?.al_entitlement_days ?? 28);
  const entitlement = base + (staff.al_carryover ?? 0);

  if (alUsed >= entitlement) {
    return `Staff has used ${alUsed} of ${entitlement} AL days — no entitlement remaining`;
  }

  return null;
}

const VALID_SHIFTS = [
  'E', 'L', 'EL', 'N', 'OFF', 'AL', 'SICK', 'ADM', 'TRN', 'AVL',
  'OC-E', 'OC-L', 'OC-EL', 'OC-N',
  'AG-E', 'AG-L', 'AG-EL', 'AG-N',
  'BH-D', 'BH-N',
];
const shiftSchema = z.enum(VALID_SHIFTS);

// GET /api/scheduling?home=X — full scheduling bundle
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    // Default ±90-day rolling window; callers may widen with ?from=&to= query params.
    const now = new Date();
    const fromDate = req.query.from || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 90))
      .toISOString().slice(0, 10);
    const toDate = req.query.to || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 90))
      .toISOString().slice(0, 10);

    const [staffResult, overrides, dayNotes, trainingResult, onboarding] = await Promise.all([
      staffRepo.findByHome(req.home.id),
      overrideRepo.findByHome(req.home.id, fromDate, toDate),
      dayNoteRepo.findByHome(req.home.id),
      trainingRepo.findByHome(req.home.id),
      onboardingRepo.findByHome(req.home.id),
    ]);
    const staff = staffResult.rows;
    const training = trainingResult.rows;

    // Strip PII for non-admin users — only expose scheduling-relevant fields
    let staffOut, onboardingOut;
    if (req.user.role !== 'admin') {
      staffOut = staff.map(({ id, name, role, team, pref, skill, active, start_date, contract_hours, wtr_opt_out, al_entitlement, al_carryover, leaving_date }) =>
        ({ id, name, role, team, pref, skill, active, start_date, contract_hours, wtr_opt_out, al_entitlement, al_carryover, leaving_date }));
      onboardingOut = undefined;
    } else {
      staffOut = staff;
      onboardingOut = onboarding;
    }

    res.json({
      config: req.home.config,
      staff: staffOut,
      overrides,
      day_notes: dayNotes,
      training,
      ...(onboardingOut !== undefined && { onboarding: onboardingOut }),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/scheduling/overrides?home=X — upsert single override
const overrideBodySchema = z.object({
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffId:  z.string().min(1).max(40),
  shift:    shiftSchema,
  reason:   z.string().max(200).optional(),
  source:   z.string().max(30).optional(),
  sleep_in: z.boolean().optional(),
  replaces_staff_id: z.string().min(1).max(40).optional(),
  override_hours: z.number().min(0).max(24).optional(),
});

router.put('/overrides', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = overrideBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { date, staffId, shift, reason, source, sleep_in, replaces_staff_id, override_hours } = parsed.data;

    // Validate replaces_staff_id constraints
    if (replaces_staff_id) {
      if (replaces_staff_id === staffId) {
        return res.status(400).json({ error: 'Staff cannot cover themselves' });
      }
      if (!isOTShift(shift) && !isAgencyShift(shift)) {
        return res.status(400).json({ error: 'Cover link only valid for OC/AG shifts' });
      }
    }

    if (shift === 'AL') {
      // Validate + upsert in a single transaction to prevent concurrent overbooking
      await withTransaction(async (client) => {
        const alError = await validateALOverride(req.home.id, req.home.config, date, staffId, null, client);
        if (alError) {
          // Throw to trigger rollback; caught below to return 400
          const err = new Error(alError);
          err.isALValidation = true;
          throw err;
        }
        await overrideRepo.upsertOne(req.home.id, date, staffId, { shift, reason, source, sleep_in, replaces_staff_id, override_hours });
      });
    } else {
      await overrideRepo.upsertOne(req.home.id, date, staffId, { shift, reason, source, sleep_in, replaces_staff_id, override_hours });
    }
    await auditService.log('override_upsert', req.home.slug, req.user.username, {
      date, staffId, shift,
      ...(replaces_staff_id && { replaces_staff_id }),
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.isALValidation) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// DELETE /api/scheduling/overrides?home=X&date=YYYY-MM-DD&staffId=X — delete single override
const overrideDeleteSchema = z.object({
  home:    z.string().max(100).regex(/^[a-zA-Z0-9_-]+$/),
  date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffId: z.string().min(1).max(40),
});

router.delete('/overrides', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = overrideDeleteSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    await overrideRepo.deleteOne(req.home.id, parsed.data.date, parsed.data.staffId);
    await auditService.log('override_delete', req.home.slug, req.user.username, { date: parsed.data.date, staffId: parsed.data.staffId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/scheduling/overrides/bulk?home=X — bulk upsert
const bulkBodySchema = z.object({
  overrides: z.array(z.object({
    date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    staffId:  z.string().min(1).max(40),
    shift:    shiftSchema,
    reason:   z.string().max(200).optional(),
    source:   z.string().max(30).optional(),
    sleep_in: z.boolean().optional(),
    replaces_staff_id: z.string().min(1).max(40).optional(),
    override_hours: z.number().min(0).max(24).optional(),
  })).min(1).max(500),
});

router.post('/overrides/bulk', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = bulkBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

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

    // Validate + upsert in a single transaction (B2: atomicity, B1: batch-aware AL counts)
    await withTransaction(async (client) => {
      const alOverrides = parsed.data.overrides.filter(o => o.shift === 'AL');
      if (alOverrides.length > 0) {
        const batchCtx = { dayAL: {}, staffAL: {} };
        for (const o of alOverrides) {
          const alError = await validateALOverride(req.home.id, req.home.config, o.date, o.staffId, batchCtx, client);
          if (alError) {
            const err = new Error(alError);
            err.isALValidation = true;
            throw err;
          }
          // Track in-batch counts so subsequent items see accumulated state
          batchCtx.dayAL[o.date] = (batchCtx.dayAL[o.date] ?? 0) + 1;
          batchCtx.staffAL[o.staffId] = (batchCtx.staffAL[o.staffId] ?? 0) + 1;
        }
      }
      await overrideRepo.upsertBulk(req.home.id, parsed.data.overrides, client);
    });

    await auditService.log('override_bulk_upsert', req.home.slug, req.user.username, { count: parsed.data.overrides.length });
    res.json({ ok: true, count: parsed.data.overrides.length });
  } catch (err) {
    if (err.isALValidation) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// DELETE /api/scheduling/overrides/month?home=X&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD — delete range
const monthDeleteSchema = z.object({
  home:     z.string().max(100).regex(/^[a-zA-Z0-9_-]+$/),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.delete('/overrides/month', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = monthDeleteSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { fromDate, toDate } = parsed.data;
    if (fromDate > toDate) return res.status(400).json({ error: 'fromDate must be <= toDate' });
    // Prevent accidental full wipe — max 366 days
    const from = new Date(fromDate), to = new Date(toDate);
    if ((to - from) / 86400000 > 366) return res.status(400).json({ error: 'Date range exceeds 366 days' });
    const deleted = await overrideRepo.deleteForDateRange(req.home.id, fromDate, toDate);
    await auditService.log('override_month_revert', req.home.slug, req.user.username, { fromDate, toDate, deleted });
    res.json({ ok: true, deleted });
  } catch (err) {
    next(err);
  }
});

// PUT /api/scheduling/day-notes?home=X — upsert or delete a day note
const dayNoteSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(5000),
});

router.put('/day-notes', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = dayNoteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { date, note } = parsed.data;
    if (note.trim() === '') {
      await dayNoteRepo.deleteOne(req.home.id, date);
      await auditService.log('day_note_delete', req.home.slug, req.user.username, { date });
    } else {
      await dayNoteRepo.upsertOne(req.home.id, date, note);
      await auditService.log('day_note_upsert', req.home.slug, req.user.username, { date });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
