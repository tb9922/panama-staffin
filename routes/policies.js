import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import * as policyRepo from '../repositories/policyRepo.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { nullableDateInput } from '../lib/zodHelpers.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const dateSchema = nullableDateInput;

const policyBodySchema = z.object({
  policy_name:            z.string().min(1).max(500),
  policy_ref:             z.string().max(100).nullable().optional(),
  category:               z.string().max(200).nullable().optional(),
  doc_version:            z.string().max(50).nullable().optional(),
  last_reviewed:          dateSchema.optional(),
  next_review_due:        dateSchema.optional(),
  review_frequency_months: z.coerce.number().int().min(1).max(60).nullable().optional(),
  status:                 z.enum(['current', 'under_review', 'due', 'overdue', 'not_reviewed']).nullable().optional(),
  reviewed_by:            z.string().max(200).nullable().optional(),
  approved_by:            z.string().max(200).nullable().optional(),
  changes:                z.array(z.object({
    version: z.string().max(50),
    date:    dateSchema.optional(),
    summary: z.string().max(2000).nullable().optional(),
  })).max(200).optional(),
  notes:                  z.string().max(5000).nullable().optional(),
});
const policyUpdateSchema = policyBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

// GET /api/policies?home=X
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'read'), async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const policiesResult = await policyRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset });
    res.json({ policies: policiesResult.rows, _total: policiesResult.total });
  } catch (err) { next(err); }
});

// POST /api/policies?home=X
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const parsed = policyBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const policy = await policyRepo.upsert(req.home.id, parsed.data);
    await auditService.log('policy_create', req.home.slug, req.user.username, { id: policy?.id });
    res.status(201).json(policy);
  } catch (err) { next(err); }
});

// PUT /api/policies/:id?home=X
router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = policyUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await policyRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const version = parsed.data._version != null ? parsed.data._version : null;
    const policy = await policyRepo.update(idParsed.data, req.home.id, parsed.data, version);
    if (policy === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, policy);
    await auditService.log('policy_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
    res.json(policy);
  } catch (err) { next(err); }
});

// DELETE /api/policies/:id?home=X
router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await policyRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await auditService.log('policy_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
