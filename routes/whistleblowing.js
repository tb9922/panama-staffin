import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as whistleblowingRepo from '../repositories/whistleblowingRepo.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter } from '../lib/rateLimiter.js';

const router = Router();
router.use(writeRateLimiter);
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
// anonymous is immutable after creation — omit from update schema to prevent de-anonymisation
const concernUpdateSchema = concernBodySchema.omit({ anonymous: true }).partial();

// GET /api/whistleblowing?home=X
router.get('/', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const concernsResult = await whistleblowingRepo.findByHome(req.home.id);
    const concerns = concernsResult.rows;
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
    const createData = { ...parsed.data };
    // Strip identifying info when concern is anonymous
    if (createData.anonymous) {
      delete createData.raised_by_role;
    }
    const concern = await whistleblowingRepo.upsert(req.home.id, createData);
    await auditService.log('whistleblowing_create', req.home.slug, req.user.username, { id: concern?.id });
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
    const existing = await whistleblowingRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const version = req.body._version != null ? parseInt(req.body._version, 10) : null;
    const concern = await whistleblowingRepo.update(idParsed.data, req.home.id, parsed.data, version);
    if (concern === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    let changes = diffFields(existing, concern);
    // Strip raised_by_role from audit diff for anonymous concerns to prevent de-anonymisation
    if (concern.anonymous) {
      changes = changes.filter(c => c.field !== 'raised_by_role');
    }
    await auditService.log('whistleblowing_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
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
    await auditService.log('whistleblowing_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
