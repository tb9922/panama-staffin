import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as dolsRepo from '../repositories/dolsRepo.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const dolsBodySchema = z.object({
  resident_name:          z.string().min(1).max(200),
  dob:                    dateSchema.optional(),
  room_number:            z.string().max(50).nullable().optional(),
  application_type:       z.enum(['dols', 'lps']).optional(),
  application_date:       dateSchema,
  authorised:             z.boolean().optional(),
  authorisation_date:     dateSchema.optional(),
  expiry_date:            dateSchema.optional(),
  authorisation_number:   z.string().max(200).nullable().optional(),
  authorising_authority:  z.string().max(200).nullable().optional(),
  restrictions:           z.array(z.string().max(500)).optional(),
  reviewed_date:          dateSchema.optional(),
  review_status:          z.string().max(50).nullable().optional(),
  next_review_date:       dateSchema.optional(),
  notes:                  z.string().max(5000).nullable().optional(),
});
const dolsUpdateSchema = dolsBodySchema.partial();

const mcaBodySchema = z.object({
  resident_name:          z.string().min(1).max(200),
  assessment_date:        dateSchema,
  assessor:               z.string().max(200).nullable().optional(),
  decision_area:          z.string().max(500).nullable().optional(),
  lacks_capacity:         z.boolean().optional(),
  best_interest_decision: z.string().max(5000).nullable().optional(),
  next_review_date:       dateSchema.optional(),
  notes:                  z.string().max(5000).nullable().optional(),
});
const mcaUpdateSchema = mcaBodySchema.partial();

// GET /api/dols?home=X
router.get('/', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const [dols, mcaAssessments] = await Promise.all([
      dolsRepo.findByHome(req.home.id),
      dolsRepo.findMcaByHome(req.home.id),
    ]);
    res.json({ dols, mcaAssessments });
  } catch (err) { next(err); }
});

// POST /api/dols?home=X — create DoLS record
router.post('/', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = dolsBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = await dolsRepo.upsertDols(req.home.id, parsed.data);
    res.status(201).json(record);
  } catch (err) { next(err); }
});

// PUT /api/dols/:id?home=X — update DoLS record
router.put('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = dolsUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = await dolsRepo.upsertDols(req.home.id, { ...parsed.data, id: idParsed.data });
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  } catch (err) { next(err); }
});

// DELETE /api/dols/:id?home=X — soft delete DoLS record
router.delete('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await dolsRepo.softDeleteDols(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/dols/mca?home=X — create MCA assessment
router.post('/mca', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = mcaBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = await dolsRepo.upsertMca(req.home.id, parsed.data);
    res.status(201).json(record);
  } catch (err) { next(err); }
});

// PUT /api/dols/mca/:id?home=X — update MCA assessment
router.put('/mca/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = mcaUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = await dolsRepo.upsertMca(req.home.id, { ...parsed.data, id: idParsed.data });
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  } catch (err) { next(err); }
});

// DELETE /api/dols/mca/:id?home=X — soft delete MCA assessment
router.delete('/mca/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await dolsRepo.softDeleteMca(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
