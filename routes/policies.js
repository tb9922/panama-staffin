import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as policyRepo from '../repositories/policyRepo.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const policyBodySchema = z.object({
  policy_name:            z.string().min(1).max(500),
  policy_ref:             z.string().max(100).nullable().optional(),
  category:               z.string().max(200).nullable().optional(),
  version:                z.string().max(50).nullable().optional(),
  last_reviewed:          dateSchema.optional(),
  next_review_due:        dateSchema.optional(),
  review_frequency_months: z.coerce.number().int().min(1).max(60).nullable().optional(),
  status:                 z.string().max(50).nullable().optional(),
  reviewed_by:            z.string().max(200).nullable().optional(),
  approved_by:            z.string().max(200).nullable().optional(),
  changes:                z.array(z.object({
    version: z.string().max(50),
    date:    dateSchema.optional(),
    summary: z.string().max(2000).nullable().optional(),
  })).max(200).optional(),
  notes:                  z.string().max(5000).nullable().optional(),
});
const policyUpdateSchema = policyBodySchema.partial();

// GET /api/policies?home=X
router.get('/', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const policies = await policyRepo.findByHome(req.home.id);
    res.json({ policies });
  } catch (err) { next(err); }
});

// POST /api/policies?home=X
router.post('/', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = policyBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const policy = await policyRepo.upsert(req.home.id, parsed.data);
    res.status(201).json(policy);
  } catch (err) { next(err); }
});

// PUT /api/policies/:id?home=X
router.put('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = policyUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const policy = await policyRepo.update(idParsed.data, req.home.id, parsed.data);
    if (!policy) return res.status(404).json({ error: 'Not found' });
    res.json(policy);
  } catch (err) { next(err); }
});

// DELETE /api/policies/:id?home=X
router.delete('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await policyRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
