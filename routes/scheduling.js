import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as dayNoteRepo from '../repositories/dayNoteRepo.js';
import * as trainingRepo from '../repositories/trainingRepo.js';
import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();
const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/);

async function resolveHome(req, res) {
  const p = homeIdSchema.safeParse(req.query.home);
  if (!p.success || !p.data) { res.status(400).json({ error: 'home parameter is required' }); return null; }
  const home = await homeRepo.findBySlug(p.data);
  if (!home) { res.status(404).json({ error: 'Home not found' }); return null; }
  return home;
}

// GET /api/scheduling?home=X — full scheduling bundle
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;

    const [staff, overrides, dayNotes, training, onboarding] = await Promise.all([
      staffRepo.findByHome(home.id),
      overrideRepo.findByHome(home.id),
      dayNoteRepo.findByHome(home.id),
      trainingRepo.findByHome(home.id),
      onboardingRepo.findByHome(home.id),
    ]);

    // Strip PII for viewer role
    const staffOut = req.user.role !== 'admin'
      ? staff.map(s => ({ ...s, date_of_birth: null, ni_number: null }))
      : staff;

    res.json({
      config: home.config,
      staff: staffOut,
      overrides,
      day_notes: dayNotes,
      training,
      onboarding,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/scheduling/overrides?home=X — upsert single override
const overrideBodySchema = z.object({
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffId:  z.string().min(1).max(40),
  shift:    z.string().min(1).max(10),
  reason:   z.string().max(200).optional(),
  source:   z.string().max(30).optional(),
  sleep_in: z.boolean().optional(),
});

router.put('/overrides', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = overrideBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const home = await resolveHome(req, res);
    if (!home) return;
    const { date, staffId, shift, reason, source, sleep_in } = parsed.data;
    await overrideRepo.upsertOne(home.id, date, staffId, { shift, reason, source, sleep_in });
    await auditService.log('override_upsert', home.slug, req.user.username, { date, staffId, shift });
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

router.delete('/overrides', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = overrideDeleteSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const home = await resolveHome(req, res);
    if (!home) return;
    await overrideRepo.deleteOne(home.id, parsed.data.date, parsed.data.staffId);
    await auditService.log('override_delete', home.slug, req.user.username, { date: parsed.data.date, staffId: parsed.data.staffId });
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
    shift:    z.string().min(1).max(10),
    reason:   z.string().max(200).optional(),
    source:   z.string().max(30).optional(),
    sleep_in: z.boolean().optional(),
  })).min(1).max(500),
});

router.post('/overrides/bulk', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = bulkBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const home = await resolveHome(req, res);
    if (!home) return;
    await overrideRepo.upsertBulk(home.id, parsed.data.overrides);
    await auditService.log('override_bulk_upsert', home.slug, req.user.username, { count: parsed.data.overrides.length });
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

router.delete('/overrides/month', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = monthDeleteSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { fromDate, toDate } = parsed.data;
    if (fromDate > toDate) return res.status(400).json({ error: 'fromDate must be <= toDate' });
    // Prevent accidental full wipe — max 366 days
    const from = new Date(fromDate), to = new Date(toDate);
    if ((to - from) / 86400000 > 366) return res.status(400).json({ error: 'Date range exceeds 366 days' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const deleted = await overrideRepo.deleteForDateRange(home.id, fromDate, toDate);
    await auditService.log('override_month_revert', home.slug, req.user.username, { fromDate, toDate, deleted });
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

router.put('/day-notes', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = dayNoteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const home = await resolveHome(req, res);
    if (!home) return;
    const { date, note } = parsed.data;
    if (note.trim() === '') {
      await dayNoteRepo.deleteOne(home.id, date);
    } else {
      await dayNoteRepo.upsertOne(home.id, date, note);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
