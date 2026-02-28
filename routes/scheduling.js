import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import { writeRateLimiter } from '../lib/rateLimiter.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as dayNoteRepo from '../repositories/dayNoteRepo.js';
import * as trainingRepo from '../repositories/trainingRepo.js';
import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();
router.use(writeRateLimiter);

/**
 * Validate an AL override before allowing it.
 * Checks max_al_same_day and per-staff entitlement.
 * Returns error string or null if valid.
 */
async function validateALOverride(homeId, config, date, staffId) {
  // 1. Check max AL per day (excluding this staff's existing override on this date)
  const maxAL = config?.max_al_same_day || 2;
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM shift_overrides
     WHERE home_id = $1 AND date = $2 AND shift = 'AL' AND staff_id != $3`,
    [homeId, date, staffId]
  );
  if (countRows[0].cnt >= maxAL) {
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
  const { rows: alRows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM shift_overrides
     WHERE home_id = $1 AND staff_id = $2 AND shift = 'AL'
       AND date >= $3 AND date <= $4`,
    [homeId, staffId, lyStartStr, lyEndStr]
  );
  const alUsed = alRows[0].cnt;

  // Get staff entitlement
  const { rows: staffRows } = await pool.query(
    `SELECT al_entitlement, al_carryover FROM staff WHERE home_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [homeId, staffId]
  );
  if (staffRows.length === 0) return null; // agency/unknown staff — skip entitlement check
  const staff = staffRows[0];
  const base = staff.al_entitlement != null ? staff.al_entitlement : (config?.al_entitlement_days || 28);
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
router.get('/', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const [staffResult, overrides, dayNotes, trainingResult, onboarding] = await Promise.all([
      staffRepo.findByHome(req.home.id),
      overrideRepo.findByHome(req.home.id),
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
});

router.put('/overrides', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = overrideBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { date, staffId, shift, reason, source, sleep_in } = parsed.data;
    if (shift === 'AL') {
      const alError = await validateALOverride(req.home.id, req.home.config, date, staffId);
      if (alError) return res.status(400).json({ error: alError });
    }
    await overrideRepo.upsertOne(req.home.id, date, staffId, { shift, reason, source, sleep_in });
    await auditService.log('override_upsert', req.home.slug, req.user.username, { date, staffId, shift });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/scheduling/overrides?home=X&date=YYYY-MM-DD&staffId=X — delete single override
const overrideDeleteSchema = z.object({
  home:    z.string().max(100).regex(/^[a-zA-Z0-9_-]+$/),
  date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffId: z.string().min(1).max(40),
});

router.delete('/overrides', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
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
  })).min(1).max(500),
});

router.post('/overrides/bulk', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = bulkBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    // Validate AL overrides before bulk upsert
    const alOverrides = parsed.data.overrides.filter(o => o.shift === 'AL');
    for (const o of alOverrides) {
      const alError = await validateALOverride(req.home.id, req.home.config, o.date, o.staffId);
      if (alError) return res.status(400).json({ error: alError });
    }
    await overrideRepo.upsertBulk(req.home.id, parsed.data.overrides);
    await auditService.log('override_bulk_upsert', req.home.slug, req.user.username, { count: parsed.data.overrides.length });
    res.json({ ok: true, count: parsed.data.overrides.length });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/scheduling/overrides/month?home=X&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD — delete range
const monthDeleteSchema = z.object({
  home:     z.string().max(100).regex(/^[a-zA-Z0-9_-]+$/),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.delete('/overrides/month', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
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

router.put('/day-notes', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
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
