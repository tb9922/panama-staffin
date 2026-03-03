import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import { withTransaction } from '../db.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';

const router = Router();
const staffIdSchema = z.string().min(1).max(20);

const STAFF_ROLES = ['Senior Carer', 'Carer', 'Team Lead', 'Night Senior', 'Night Carer', 'Float Senior', 'Float Carer'];
const STAFF_TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];

const staffBodySchema = z.object({
  id:              z.string().min(1).max(20),
  name:            z.string().min(1).max(200),
  role:            z.enum(STAFF_ROLES),
  team:            z.enum(STAFF_TEAMS),
  pref:            z.enum(['E', 'L', 'EL']).nullable().optional(),
  skill:           z.number().int().min(0).max(5).optional(),
  hourly_rate:     z.number().positive().optional(),
  active:          z.boolean().optional(),
  wtr_opt_out:     z.boolean().optional(),
  start_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  contract_hours:  z.number().min(0).nullable().optional(),
  date_of_birth:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  ni_number:       z.string().regex(/^[A-Z]{2}\d{6}[A-D]$/).nullable().optional(),
  al_entitlement:  z.number().min(0).max(2000).nullable().optional(),
  al_carryover:    z.number().min(0).max(500).optional(),
  leaving_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
const staffUpdateSchema = staffBodySchema.partial();

// POST /api/staff?home=X — create a new staff member
// Client generates the ID (format "S001", "S002" etc.) — server accepts it as-is
router.post('/', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = staffBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const staff = await staffRepo.upsertOne(req.home.id, parsed.data);
    await auditService.log('staff_create', req.home.slug, req.user.username, { staff_id: parsed.data.id });
    res.status(201).json(staff);
  } catch (err) { next(err); }
});

// PUT /api/staff/:staffId?home=X — update a staff member
router.put('/:staffId', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = staffIdSchema.safeParse(req.params.staffId);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid staff ID' });
    const parsed = staffUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await staffRepo.findById(req.home.id, idParsed.data);
    if (!existing) return res.status(404).json({ error: 'Staff member not found' });
    const version = req.body._version != null ? parseInt(req.body._version, 10) : null;
    const staff = await staffRepo.updateOne(req.home.id, idParsed.data, parsed.data, version);
    if (staff === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, staff);
    await auditService.log('staff_update', req.home.slug, req.user.username, { staff_id: idParsed.data, changes });
    res.json(staff);
  } catch (err) { next(err); }
});

// DELETE /api/staff/:staffId?home=X — soft-delete staff + remove their overrides
router.delete('/:staffId', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = staffIdSchema.safeParse(req.params.staffId);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid staff ID' });
    await withTransaction(async (client) => {
      const deleted = await staffRepo.softDeleteOne(req.home.id, idParsed.data, client);
      if (!deleted) throw Object.assign(new Error('Staff member not found'), { status: 404 });
      await overrideRepo.deleteForStaff(req.home.id, idParsed.data, client);
    });
    await auditService.log('staff_deactivate', req.home.slug, req.user.username, { staff_id: idParsed.data });
    res.json({ ok: true });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

export default router;
