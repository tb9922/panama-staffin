import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as dolsRepo from '../repositories/dolsRepo.js';

const router = Router();

const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).optional();
const idSchema = z.string().min(1).max(100);

async function resolveHome(req, res) {
  const p = homeIdSchema.safeParse(req.query.home);
  if (!p.success || !p.data) { res.status(400).json({ error: 'home parameter is required' }); return null; }
  const home = await homeRepo.findBySlug(p.data);
  if (!home) { res.status(404).json({ error: 'Home not found' }); return null; }
  return home;
}

// GET /api/dols?home=X
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const [dols, mcaAssessments] = await Promise.all([
      dolsRepo.findByHome(home.id),
      dolsRepo.findMcaByHome(home.id),
    ]);
    res.json({ dols, mcaAssessments });
  } catch (err) { next(err); }
});

// POST /api/dols?home=X — create DoLS record
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    if (!req.body?.resident_name || !req.body?.application_date) {
      return res.status(400).json({ error: 'resident_name and application_date are required' });
    }
    const record = await dolsRepo.upsertDols(home.id, req.body);
    res.status(201).json(record);
  } catch (err) { next(err); }
});

// PUT /api/dols/:id?home=X — update DoLS record
router.put('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const record = await dolsRepo.upsertDols(home.id, { ...req.body, id: idParsed.data });
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  } catch (err) { next(err); }
});

// DELETE /api/dols/:id?home=X — soft delete DoLS record
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const deleted = await dolsRepo.softDeleteDols(idParsed.data, home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/dols/mca?home=X — create MCA assessment
router.post('/mca', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    if (!req.body?.resident_name || !req.body?.assessment_date) {
      return res.status(400).json({ error: 'resident_name and assessment_date are required' });
    }
    const record = await dolsRepo.upsertMca(home.id, req.body);
    res.status(201).json(record);
  } catch (err) { next(err); }
});

// PUT /api/dols/mca/:id?home=X — update MCA assessment
router.put('/mca/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const record = await dolsRepo.upsertMca(home.id, { ...req.body, id: idParsed.data });
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  } catch (err) { next(err); }
});

// DELETE /api/dols/mca/:id?home=X — soft delete MCA assessment
router.delete('/mca/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const deleted = await dolsRepo.softDeleteMca(idParsed.data, home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
