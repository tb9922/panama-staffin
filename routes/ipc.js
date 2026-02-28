import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as ipcRepo from '../repositories/ipcRepo.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

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
  })).optional(),
  corrective_actions: z.array(z.object({
    description:    z.string().max(2000),
    assigned_to:    z.string().max(200).nullable().optional(),
    due_date:       dateSchema.optional(),
    completed_date: dateSchema.optional(),
    status:         z.string().max(50).nullable().optional(),
  })).optional(),
  outbreak:           z.object({
    suspected:          z.boolean().optional(),
    type:               z.string().max(200).nullable().optional(),
    start_date:         dateSchema.optional(),
    affected_staff:     z.coerce.number().int().min(0).nullable().optional(),
    affected_residents: z.coerce.number().int().min(0).nullable().optional(),
    measures:           z.string().max(5000).nullable().optional(),
    end_date:           dateSchema.optional(),
    status:             z.string().max(50).nullable().optional(),
  }).nullable().optional(),
  notes:              z.string().max(5000).nullable().optional(),
});
const ipcUpdateSchema = ipcBodySchema.partial();

// GET /api/ipc?home=X
router.get('/', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const audits = await ipcRepo.findByHome(req.home.id);
    const auditTypes = req.home.config?.ipc_audit_types || [];
    res.json({ audits, auditTypes });
  } catch (err) { next(err); }
});

// POST /api/ipc?home=X
router.post('/', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = ipcBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const audit = await ipcRepo.upsert(req.home.id, parsed.data);
    res.status(201).json(audit);
  } catch (err) { next(err); }
});

// PUT /api/ipc/:id?home=X
router.put('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = ipcUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const audit = await ipcRepo.upsert(req.home.id, { ...parsed.data, id: idParsed.data });
    if (!audit) return res.status(404).json({ error: 'Not found' });
    res.json(audit);
  } catch (err) { next(err); }
});

// DELETE /api/ipc/:id?home=X
router.delete('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await ipcRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
