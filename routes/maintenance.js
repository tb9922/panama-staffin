import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as maintenanceRepo from '../repositories/maintenanceRepo.js';

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

// GET /api/maintenance?home=X
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const checks = await maintenanceRepo.findByHome(home.id);
    const maintenanceCategories = home.config?.maintenance_categories || [];
    res.json({ checks, maintenanceCategories });
  } catch (err) { next(err); }
});

// POST /api/maintenance?home=X
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    if (!req.body?.description || !req.body?.category) {
      return res.status(400).json({ error: 'description and category are required' });
    }
    const check = await maintenanceRepo.upsert(home.id, req.body);
    res.status(201).json(check);
  } catch (err) { next(err); }
});

// PUT /api/maintenance/:id?home=X
router.put('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const check = await maintenanceRepo.upsert(home.id, { ...req.body, id: idParsed.data });
    if (!check) return res.status(404).json({ error: 'Not found' });
    res.json(check);
  } catch (err) { next(err); }
});

// DELETE /api/maintenance/:id?home=X
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const deleted = await maintenanceRepo.softDelete(idParsed.data, home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
