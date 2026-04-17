import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import * as ropaRepo from '../repositories/ropaRepo.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { zodError } from '../errors.js';
import { nullableDateInput } from '../lib/zodHelpers.js';
import { splitVersion } from '../lib/versionedPayload.js';
import { validateRopaStatusChange } from '../lib/statusTransitions.js';

const router = Router();

const ropaStatusSchema = z.enum(['active', 'under_review', 'archived']).optional();

const idSchema = z.coerce.number().int().positive();
const dateSchema = nullableDateInput;
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const bodySchema = z.object({
  purpose: z.string().min(1).max(500),
  legal_basis: z.enum(['consent', 'contract', 'legal_obligation', 'vital_interests', 'public_task', 'legitimate_interests']),
  categories_of_individuals: z.string().min(1).max(500),
  categories_of_data: z.string().min(1).max(500),
  categories_of_recipients: z.string().max(500).nullable().optional(),
  international_transfers: z.boolean().optional(),
  transfer_safeguards: z.string().max(5000).nullable().optional(),
  retention_period: z.string().max(200).nullable().optional(),
  security_measures: z.string().max(5000).nullable().optional(),
  data_source: z.string().max(200).nullable().optional(),
  system_or_asset: z.string().max(200).nullable().optional(),
  special_category: z.boolean().optional(),
  dpia_required: z.boolean().optional(),
  status: z.enum(['active', 'under_review', 'archived']).optional(),
  last_reviewed: dateSchema.optional(),
  next_review_due: dateSchema.optional(),
  notes: z.string().max(5000).nullable().optional(),
});
const updateSchema = bodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

// GET /api/ropa?home=X
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'read'), async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const filters = { limit: pg.limit, offset: pg.offset };
    const statusP = ropaStatusSchema.safeParse(req.query.status);
    if (statusP.success && statusP.data) filters.status = statusP.data;
    res.json(await ropaRepo.findAll(req.home.id, filters));
  } catch (err) { next(err); }
});

// GET /api/ropa/:id?home=X
router.get('/:id', readRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'read'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid ID' });
    const result = await ropaRepo.findById(idP.data, req.home.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/ropa?home=X
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const result = await ropaRepo.create(req.home.id, { ...parsed.data, created_by: req.user.username });
    await auditService.log('ropa_create', req.home.slug, req.user.username, { id: result.id, purpose: result.purpose });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PUT /api/ropa/:id?home=X
router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await ropaRepo.findById(idP.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const statusError = validateRopaStatusChange(existing, parsed.data);
    if (statusError) return res.status(400).json({ error: statusError });
    const { version, payload } = splitVersion(parsed.data);
    const result = await ropaRepo.update(idP.data, req.home.id, payload, null, version);
    if (result === null) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    await auditService.log('ropa_update', req.home.slug, req.user.username, { id: idP.data, changes: diffFields(existing, result) });
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/ropa/:id?home=X
router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid ID' });
    const result = await ropaRepo.softDelete(idP.data, req.home.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    await auditService.log('ropa_delete', req.home.slug, req.user.username, { id: idP.data });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

export default router;
