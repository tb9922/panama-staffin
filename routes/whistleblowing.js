import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as whistleblowingRepo from '../repositories/whistleblowingRepo.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const concernBodySchema = z.object({
  date_raised:              dateSchema,
  raised_by_role:           z.string().max(200).nullable().optional(),
  anonymous:                z.boolean().optional(),
  category:                 z.enum(['malpractice', 'bullying', 'safety', 'compliance', 'other']),
  description:              z.string().max(10000).nullable().optional(),
  severity:                 z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status:                   z.string().max(50).nullable().optional(),
  acknowledgement_date:     dateSchema.optional(),
  investigator:             z.string().max(200).nullable().optional(),
  investigation_start_date: dateSchema.optional(),
  findings:                 z.string().max(10000).nullable().optional(),
  outcome:                  z.string().max(200).nullable().optional(),
  outcome_details:          z.string().max(10000).nullable().optional(),
  reporter_protected:       z.boolean().optional(),
  protection_details:       z.string().max(5000).nullable().optional(),
  follow_up_date:           dateSchema.optional(),
  follow_up_completed:      z.boolean().optional(),
  resolution_date:          dateSchema.optional(),
  lessons_learned:          z.string().max(5000).nullable().optional(),
});
const concernUpdateSchema = concernBodySchema.partial();

// GET /api/whistleblowing?home=X
router.get('/', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const concerns = await whistleblowingRepo.findByHome(req.home.id);
    // Strip raised_by_role from anonymous concerns to prevent de-anonymisation
    const safe = concerns.map(c => {
      if (c.anonymous) {
        const { raised_by_role, ...rest } = c;
        return rest;
      }
      return c;
    });
    res.json({ concerns: safe });
  } catch (err) { next(err); }
});

// POST /api/whistleblowing?home=X
router.post('/', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = concernBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const concern = await whistleblowingRepo.upsert(req.home.id, parsed.data);
    const safe = concern.anonymous ? (({ raised_by_role, ...rest }) => rest)(concern) : concern;
    res.status(201).json(safe);
  } catch (err) { next(err); }
});

// PUT /api/whistleblowing/:id?home=X
router.put('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = concernUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const concern = await whistleblowingRepo.update(idParsed.data, req.home.id, parsed.data);
    if (!concern) return res.status(404).json({ error: 'Not found' });
    const safe = concern.anonymous ? (({ raised_by_role, ...rest }) => rest)(concern) : concern;
    res.json(safe);
  } catch (err) { next(err); }
});

// DELETE /api/whistleblowing/:id?home=X
router.delete('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await whistleblowingRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
