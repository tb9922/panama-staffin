import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();
const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).optional();
const staffIdSchema = z.string().min(1).max(20);
const sectionSchema = z.enum([
  'dbs', 'rtw', 'references', 'identity', 'health', 'qualifications',
  'contract', 'induction', 'probation', 'other',
]);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

// Onboarding section data — each section has different fields but common patterns
const onboardingSectionSchema = z.object({
  status:         z.enum(['not_started', 'in_progress', 'complete', 'na']).optional(),
  date:           dateSchema.optional(),
  expiry:         dateSchema.optional(),
  reference:      z.string().max(200).nullable().optional(),
  notes:          z.string().max(5000).nullable().optional(),
  verified_by:    z.string().max(200).nullable().optional(),
  verified_date:  dateSchema.optional(),
}).catchall(z.union([z.string().max(5000), z.boolean(), z.number(), z.null()])); // allow section-specific fields with constrained types

async function resolveHome(req, res) {
  const p = homeIdSchema.safeParse(req.query.home);
  if (!p.success || !p.data) { res.status(400).json({ error: 'home parameter is required' }); return null; }
  const home = await homeRepo.findBySlug(p.data);
  if (!home) { res.status(404).json({ error: 'Home not found' }); return null; }
  return home;
}

// GET /api/onboarding?home=X
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const [onboarding, staffRows] = await Promise.all([
      onboardingRepo.findByHome(home.id),
      staffRepo.findByHome(home.id),
    ]);
    const staff = staffRows.map(s => ({ id: s.id, name: s.name, role: s.role, team: s.team, active: s.active, start_date: s.start_date }));
    res.json({ onboarding, staff });
  } catch (err) { next(err); }
});

// PUT /api/onboarding/:staffId/:section?home=X — upsert section data
router.put('/:staffId/:section', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const staffIdParsed = staffIdSchema.safeParse(req.params.staffId);
    const sectionParsed = sectionSchema.safeParse(req.params.section);
    if (!staffIdParsed.success || !sectionParsed.success) {
      return res.status(400).json({ error: 'Invalid staffId or section' });
    }
    const home = await resolveHome(req, res);
    if (!home) return;
    const bodyParsed = onboardingSectionSchema.safeParse(req.body);
    if (!bodyParsed.success) return res.status(400).json({ error: 'Validation failed', issues: bodyParsed.error.issues });
    const result = await onboardingRepo.upsertSection(home.id, staffIdParsed.data, sectionParsed.data, bodyParsed.data);
    await auditService.log('onboarding_upsert', home.slug, req.user.username, { staffId: staffIdParsed.data, section: sectionParsed.data });
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/onboarding/:staffId/:section?home=X — clear section data
router.delete('/:staffId/:section', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const staffIdParsed = staffIdSchema.safeParse(req.params.staffId);
    const sectionParsed = sectionSchema.safeParse(req.params.section);
    if (!staffIdParsed.success || !sectionParsed.success) {
      return res.status(400).json({ error: 'Invalid staffId or section' });
    }
    const home = await resolveHome(req, res);
    if (!home) return;
    await onboardingRepo.clearSection(home.id, staffIdParsed.data, sectionParsed.data);
    await auditService.log('onboarding_clear', home.slug, req.user.username, { staffId: staffIdParsed.data, section: sectionParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
