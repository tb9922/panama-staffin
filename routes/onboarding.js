import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';

const router = Router();
const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).optional();
const staffIdSchema = z.string().min(1).max(20);
const sectionSchema = z.string().min(1).max(100);

async function resolveHome(req, res) {
  const p = homeIdSchema.safeParse(req.query.home);
  if (!p.success || !p.data) { res.status(400).json({ error: 'home parameter is required' }); return null; }
  const home = await homeRepo.findBySlug(p.data);
  if (!home) { res.status(404).json({ error: 'Home not found' }); return null; }
  return home;
}

// GET /api/onboarding?home=X
router.get('/', requireAuth, async (req, res, next) => {
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
    const result = await onboardingRepo.upsertSection(home.id, staffIdParsed.data, sectionParsed.data, req.body);
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
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
