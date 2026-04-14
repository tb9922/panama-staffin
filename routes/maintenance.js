import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import * as maintenanceRepo from '../repositories/maintenanceRepo.js';
import * as auditService from '../services/auditService.js';
import { queueAutoLinkSync } from '../services/cqcAutoLinkService.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { nullableDateInput } from '../lib/zodHelpers.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const dateSchema = nullableDateInput;

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
const maintenanceUpdateSchema = maintenanceBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

// GET /api/maintenance?home=X
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const checksResult = await maintenanceRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset });
    const checks = checksResult.rows;
    const maintenanceCategories = req.home.config?.maintenance_categories || [];
    res.json({ checks, maintenanceCategories, _total: checksResult.total });
  } catch (err) { next(err); }
});

// POST /api/maintenance?home=X
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = maintenanceBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const check = await maintenanceRepo.upsert(req.home.id, parsed.data);
    await auditService.log('maintenance_create', req.home.slug, req.user.username, { id: check?.id });
    queueAutoLinkSync(req.home.id, 'maintenance', check, req.user.username);
    res.status(201).json(check);
  } catch (err) { next(err); }
});

// PUT /api/maintenance/:id?home=X
router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = maintenanceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    // Only send fields that were actually provided in the request body
    const updates = Object.fromEntries(
      Object.entries(parsed.data).filter(([_, v]) => v !== undefined)
    );
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });
    const existing = await maintenanceRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const version = parsed.data._version != null ? parsed.data._version : null;
    const check = await maintenanceRepo.update(idParsed.data, req.home.id, updates, version);
    if (check === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, check);
    await auditService.log('maintenance_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
    queueAutoLinkSync(req.home.id, 'maintenance', check, req.user.username);
    res.json(check);
  } catch (err) { next(err); }
});

// DELETE /api/maintenance/:id?home=X
router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
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
