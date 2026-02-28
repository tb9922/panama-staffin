import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as cqcEvidenceRepo from '../repositories/cqcEvidenceRepo.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const evidenceBodySchema = z.object({
  quality_statement: z.string().min(1).max(20).regex(/^(S[1-8]|E[1-6]|C[1-5]|R[1-5]|WL([1-9]|10))$/),
  type:              z.enum(['quantitative', 'qualitative']),
  title:             z.string().min(1).max(500),
  description:       z.string().max(10000).nullable().optional(),
  date_from:         dateSchema.optional(),
  date_to:           dateSchema.optional(),
});
const evidenceUpdateSchema = evidenceBodySchema.partial();

// GET /api/cqc-evidence?home=X
router.get('/', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const evidence = await cqcEvidenceRepo.findByHome(req.home.id);
    res.json({ evidence });
  } catch (err) { next(err); }
});

// POST /api/cqc-evidence?home=X
router.post('/', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = evidenceBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const item = await cqcEvidenceRepo.upsert(req.home.id, { ...parsed.data, added_by: req.user.username });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

// PUT /api/cqc-evidence/:id?home=X
router.put('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = evidenceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const item = await cqcEvidenceRepo.upsert(req.home.id, { ...parsed.data, id: idParsed.data });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) { next(err); }
});

// DELETE /api/cqc-evidence/:id?home=X
router.delete('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await cqcEvidenceRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
