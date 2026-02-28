import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as dayNoteRepo from '../repositories/dayNoteRepo.js';
import * as trainingRepo from '../repositories/trainingRepo.js';
import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();

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
    const [staff, overrides, dayNotes, training, onboarding] = await Promise.all([
      staffRepo.findByHome(req.home.id),
      overrideRepo.findByHome(req.home.id),
      dayNoteRepo.findByHome(req.home.id),
      trainingRepo.findByHome(req.home.id),
      onboardingRepo.findByHome(req.home.id),
    ]);

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
    await overrideRepo.upsertOne(req.home.id, date, staffId, { shift, reason, source, sleep_in });
    await auditService.log('override_upsert', req.home.slug, req.user.username, { date, staffId, shift });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/scheduling/overrides?home=X&date=YYYY-MM-DD&staffId=X — delete single override
const overrideDeleteSchema = z.object({
  home:    z.string().regex(/^[a-zA-Z0-9_-]+$/),
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
    await overrideRepo.upsertBulk(req.home.id, parsed.data.overrides);
    await auditService.log('override_bulk_upsert', req.home.slug, req.user.username, { count: parsed.data.overrides.length });
    res.json({ ok: true, count: parsed.data.overrides.length });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/scheduling/overrides/month?home=X&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD — delete range
const monthDeleteSchema = z.object({
  home:     z.string().regex(/^[a-zA-Z0-9_-]+$/),
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
    } else {
      await dayNoteRepo.upsertOne(req.home.id, date, note);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
