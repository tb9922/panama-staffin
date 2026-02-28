import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();
const staffIdSchema = z.string().min(1).max(20);
const sectionSchema = z.enum([
  'dbs_check', 'right_to_work', 'references', 'identity_check', 'health_declaration',
  'qualifications', 'contract', 'employment_history', 'day1_induction', 'policy_acknowledgement',
]);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

// Onboarding section data — each section has different fields but common patterns
const onboardingSectionSchema = z.object({
  status:         z.enum(['not_started', 'in_progress', 'completed', 'na']).optional(),
  date:           dateSchema.optional(),
  expiry:         dateSchema.optional(),
  reference:      z.string().max(200).nullable().optional(),
  notes:          z.string().max(5000).nullable().optional(),
  verified_by:    z.string().max(200).nullable().optional(),
  verified_date:  dateSchema.optional(),
}).catchall(z.union([z.string().max(5000), z.boolean(), z.number(), z.null()]));

// GET /api/onboarding?home=X
router.get('/', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const [onboarding, staffRows] = await Promise.all([
      onboardingRepo.findByHome(req.home.id),
      staffRepo.findByHome(req.home.id),
    ]);
    const staff = staffRows.map(s => ({ id: s.id, name: s.name, role: s.role, team: s.team, active: s.active, start_date: s.start_date }));
    res.json({ onboarding, staff });
  } catch (err) { next(err); }
});

// PUT /api/onboarding/:staffId/:section?home=X — upsert section data
router.put('/:staffId/:section', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const staffIdParsed = staffIdSchema.safeParse(req.params.staffId);
    const sectionParsed = sectionSchema.safeParse(req.params.section);
    if (!staffIdParsed.success || !sectionParsed.success) {
      return res.status(400).json({ error: 'Invalid staffId or section' });
    }
    const bodyParsed = onboardingSectionSchema.safeParse(req.body);
    if (!bodyParsed.success) return res.status(400).json({ error: 'Validation failed', issues: bodyParsed.error.issues });
    const result = await onboardingRepo.upsertSection(req.home.id, staffIdParsed.data, sectionParsed.data, bodyParsed.data);
    await auditService.log('onboarding_upsert', req.home.slug, req.user.username, { staffId: staffIdParsed.data, section: sectionParsed.data });
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/onboarding/:staffId/:section?home=X — clear section data
router.delete('/:staffId/:section', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const staffIdParsed = staffIdSchema.safeParse(req.params.staffId);
    const sectionParsed = sectionSchema.safeParse(req.params.section);
    if (!staffIdParsed.success || !sectionParsed.success) {
      return res.status(400).json({ error: 'Invalid staffId or section' });
    }
    await onboardingRepo.clearSection(req.home.id, staffIdParsed.data, sectionParsed.data);
    await auditService.log('onboarding_clear', req.home.slug, req.user.username, { staffId: staffIdParsed.data, section: sectionParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
