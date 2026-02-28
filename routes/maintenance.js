import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as maintenanceRepo from '../repositories/maintenanceRepo.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';

const router = Router();
router.use(writeRateLimiter);
const idSchema = z.string().min(1).max(100);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const maintenanceBodySchema = z.object({
  category:           z.string().min(1).max(200),
  description:        z.string().min(1).max(2000),
  frequency:          z.string().max(100).nullable().optional(),
  last_completed:     dateSchema.optional(),
  next_due:           dateSchema.optional(),
  completed_by:       z.string().max(200).nullable().optional(),
  contractor:         z.string().max(200).nullable().optional(),
  items_checked:      z.coerce.number().int().min(0).nullable().optional(),
  items_passed:       z.coerce.number().int().min(0).nullable().optional(),
  items_failed:       z.coerce.number().int().min(0).nullable().optional(),
  certificate_ref:    z.string().max(200).nullable().optional(),
  certificate_expiry: dateSchema.optional(),
  notes:              z.string().max(5000).nullable().optional(),
});
const maintenanceUpdateSchema = maintenanceBodySchema.partial();

// GET /api/maintenance?home=X
router.get('/', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const checksResult = await maintenanceRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset });
    const checks = checksResult.rows;
    const maintenanceCategories = req.home.config?.maintenance_categories || [];
    res.json({ checks, maintenanceCategories, _total: checksResult.total });
  } catch (err) { next(err); }
});

// POST /api/maintenance?home=X
router.post('/', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = maintenanceBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const check = await maintenanceRepo.upsert(req.home.id, parsed.data);
    await auditService.log('maintenance_create', req.home.slug, req.user.username, { id: check?.id });
    res.status(201).json(check);
  } catch (err) { next(err); }
});

// PUT /api/maintenance/:id?home=X
router.put('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = maintenanceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    // Only send fields that were actually provided in the request body
    const updates = Object.fromEntries(
      Object.entries(parsed.data).filter(([_, v]) => v !== undefined)
    );
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });
    const existing = await maintenanceRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const version = req.body._version != null ? parseInt(req.body._version, 10) : null;
    const check = await maintenanceRepo.update(idParsed.data, req.home.id, updates, version);
    if (check === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, check);
    await auditService.log('maintenance_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
    res.json(check);
  } catch (err) { next(err); }
});

// DELETE /api/maintenance/:id?home=X
router.delete('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await maintenanceRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await auditService.log('maintenance_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
