import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import { withTransaction } from '../db.js';
import * as auditService from '../services/auditService.js';

const router = Router();
const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).optional();
const staffIdSchema = z.string().min(1).max(20);

async function resolveHome(req, res) {
  const p = homeIdSchema.safeParse(req.query.home);
  if (!p.success || !p.data) { res.status(400).json({ error: 'home parameter is required' }); return null; }
  const home = await homeRepo.findBySlug(p.data);
  if (!home) { res.status(404).json({ error: 'Home not found' }); return null; }
  return home;
}

// POST /api/staff?home=X — create a new staff member
// Client generates the ID (format "S001", "S002" etc.) — server accepts it as-is
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    if (!req.body?.id || !req.body?.name) {
      return res.status(400).json({ error: 'id and name are required' });
    }
    const staff = await staffRepo.upsertOne(home.id, req.body);
    await auditService.log('staff_create', home.slug, req.user.username, { staff_id: req.body.id });
    res.status(201).json(staff);
  } catch (err) { next(err); }
});

// PUT /api/staff/:staffId?home=X — update a staff member
router.put('/:staffId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = staffIdSchema.safeParse(req.params.staffId);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid staff ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const staff = await staffRepo.upsertOne(home.id, { ...req.body, id: idParsed.data });
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });
    res.json(staff);
  } catch (err) { next(err); }
});

// DELETE /api/staff/:staffId?home=X — soft-delete staff + remove their overrides
router.delete('/:staffId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = staffIdSchema.safeParse(req.params.staffId);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid staff ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    await withTransaction(async (client) => {
      const deleted = await staffRepo.softDeleteOne(home.id, idParsed.data);
      if (!deleted) throw Object.assign(new Error('Staff member not found'), { status: 404 });
      await overrideRepo.deleteForStaff(home.id, idParsed.data, client);
    });
    await auditService.log('staff_delete', home.slug, req.user.username, { staff_id: idParsed.data });
    res.json({ ok: true });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

export default router;
