import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as riskRepo from '../repositories/riskRepo.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const riskBodySchema = z.object({
  title:                z.string().min(1).max(500),
  description:          z.string().max(5000).nullable().optional(),
  category:             z.enum(['staffing', 'clinical', 'operational', 'financial', 'compliance']),
  owner:                z.string().max(200).nullable().optional(),
  likelihood:           z.coerce.number().int().min(1).max(5).nullable().optional(),
  impact:               z.coerce.number().int().min(1).max(5).nullable().optional(),
  inherent_risk:        z.coerce.number().int().min(1).max(25).nullable().optional(),
  controls:             z.array(z.object({
    description:   z.string().max(2000),
    effectiveness: z.string().max(100).nullable().optional(),
  })).optional(),
  residual_likelihood:  z.coerce.number().int().min(1).max(5).nullable().optional(),
  residual_impact:      z.coerce.number().int().min(1).max(5).nullable().optional(),
  residual_risk:        z.coerce.number().int().min(1).max(25).nullable().optional(),
  actions:              z.array(z.object({
    description:    z.string().max(2000),
    owner:          z.string().max(200).nullable().optional(),
    due_date:       dateSchema.optional(),
    status:         z.string().max(50).nullable().optional(),
    completed_date: dateSchema.optional(),
  })).optional(),
  last_reviewed:        dateSchema.optional(),
  next_review:          dateSchema.optional(),
  status:               z.string().max(50).nullable().optional(),
});
const riskUpdateSchema = riskBodySchema.partial();

// GET /api/risk-register?home=X
router.get('/', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const risks = await riskRepo.findByHome(req.home.id);
    res.json({ risks });
  } catch (err) { next(err); }
});

// POST /api/risk-register?home=X
router.post('/', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = riskBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const risk = await riskRepo.upsert(req.home.id, parsed.data);
    res.status(201).json(risk);
  } catch (err) { next(err); }
});

// PUT /api/risk-register/:id?home=X
router.put('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = riskUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const risk = await riskRepo.upsert(req.home.id, { ...parsed.data, id: idParsed.data });
    if (!risk) return res.status(404).json({ error: 'Not found' });
    res.json(risk);
  } catch (err) { next(err); }
});

// DELETE /api/risk-register/:id?home=X
router.delete('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await riskRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
