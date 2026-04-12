import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import * as ipcRepo from '../repositories/ipcRepo.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { nullableDateInput } from '../lib/zodHelpers.js';
import { validateIpcOutbreakStatusChange } from '../lib/statusTransitions.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const dateSchema = nullableDateInput;

function normalizeOutbreakStatus(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'open' || normalized === 'active') return 'suspected';
  if (normalized === 'ongoing') return 'confirmed';
  if (normalized === 'closed' || normalized === 'complete' || normalized === 'completed') return 'resolved';
  return normalized;
}

const outbreakStatusSchema = z.preprocess(
  normalizeOutbreakStatus,
  z.enum(['suspected', 'confirmed', 'contained', 'resolved']).nullable().optional()
);

const ipcBodySchema = z.object({
  audit_date:         dateSchema,
  audit_type:         z.string().min(1).max(200),
  auditor:            z.string().max(200).nullable().optional(),
  overall_score:      z.coerce.number().min(0).max(100).nullable().optional(),
  compliance_pct:     z.coerce.number().min(0).max(100).nullable().optional(),
  risk_areas:         z.array(z.object({
    area:     z.string().max(500),
    severity: z.string().max(50),
    details:  z.string().max(5000).nullable().optional(),
  })).max(50).optional(),
  corrective_actions: z.array(z.object({
    description:    z.string().max(2000),
    assigned_to:    z.string().max(200).nullable().optional(),
    due_date:       dateSchema.optional(),
    completed_date: dateSchema.optional(),
    status:         z.enum(['open', 'in_progress', 'completed', 'overdue']).nullable().optional(),
  })).max(100).optional(),
  outbreak:           z.object({
    suspected:          z.boolean().optional(),
    type:               z.string().max(200).nullable().optional(),
    start_date:         dateSchema.optional(),
    affected_staff:     z.coerce.number().int().min(0).nullable().optional(),
    affected_residents: z.coerce.number().int().min(0).nullable().optional(),
    measures:           z.string().max(5000).nullable().optional(),
    end_date:           dateSchema.optional(),
    status:             outbreakStatusSchema,
  }).nullable().optional(),
  notes:              z.string().max(5000).nullable().optional(),
});
const ipcUpdateSchema = ipcBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

// GET /api/ipc?home=X
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const auditsResult = await ipcRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset });
    const audits = auditsResult.rows;
    const auditTypes = req.home.config?.ipc_audit_types || [];
    res.json({ audits, auditTypes, _total: auditsResult.total });
  } catch (err) { next(err); }
});

// POST /api/ipc?home=X
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = ipcBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const audit = await ipcRepo.upsert(req.home.id, parsed.data);
    await auditService.log('ipc_create', req.home.slug, req.user.username, { id: audit?.id });
    res.status(201).json(audit);
  } catch (err) { next(err); }
});

// PUT /api/ipc/:id?home=X
router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = ipcUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    // Only send fields that were actually provided in the request body
    const updates = Object.fromEntries(
      Object.entries(parsed.data).filter(([_, v]) => v !== undefined)
    );
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });
    const existing = await ipcRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const transitionError = validateIpcOutbreakStatusChange(existing, updates);
    if (transitionError) return res.status(400).json({ error: transitionError });
    const version = parsed.data._version != null ? parsed.data._version : null;
    const audit = await ipcRepo.update(idParsed.data, req.home.id, updates, version);
    if (audit === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, audit);
    await auditService.log('ipc_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
    res.json(audit);
  } catch (err) { next(err); }
});

// DELETE /api/ipc/:id?home=X
router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await ipcRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await auditService.log('ipc_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
