import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import * as dpiaRepo from '../repositories/dpiaRepo.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { zodError } from '../errors.js';

const router = Router();

const dpiaStatusSchema = z.enum(['screening', 'in_progress', 'completed', 'approved', 'review_due']).optional();

const idSchema = z.coerce.number().int().positive();
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const bodySchema = z.object({
  title: z.string().min(1).max(300),
  processing_description: z.string().min(1).max(10000),
  purpose: z.string().max(5000).nullable().optional(),
  scope: z.string().max(5000).nullable().optional(),
  screening_result: z.enum(['required', 'not_required', 'recommended']).optional(),
  screening_rationale: z.string().max(5000).nullable().optional(),
  high_risk_triggers: z.string().max(5000).nullable().optional(),
  necessity_assessment: z.string().max(5000).nullable().optional(),
  proportionality_assessment: z.string().max(5000).nullable().optional(),
  legal_basis: z.enum(['consent', 'contract', 'legal_obligation', 'vital_interests', 'public_task', 'legitimate_interests']).nullable().optional(),
  risk_assessment: z.string().max(10000).nullable().optional(),
  risk_level: z.enum(['low', 'medium', 'high', 'very_high']).optional(),
  measures: z.string().max(10000).nullable().optional(),
  residual_risk: z.enum(['low', 'medium', 'high', 'very_high']).optional(),
  consultation_required: z.boolean().optional(),
  dpo_advice: z.string().max(5000).nullable().optional(),
  dpo_advice_date: dateSchema.optional(),
  ico_consultation: z.boolean().optional(),
  ico_consultation_date: dateSchema.optional(),
  stakeholder_views: z.string().max(5000).nullable().optional(),
  status: z.enum(['screening', 'in_progress', 'completed', 'approved', 'review_due']).optional(),
  approved_by: z.string().max(100).nullable().optional(),
  approved_date: dateSchema.optional(),
  review_date: dateSchema.optional(),
  next_review_due: dateSchema.optional(),
  notes: z.string().max(5000).nullable().optional(),
});
const updateSchema = bodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'read'), async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const filters = { limit: pg.limit, offset: pg.offset };
    const statusP = dpiaStatusSchema.safeParse(req.query.status);
    if (statusP.success && statusP.data) filters.status = statusP.data;
    res.json(await dpiaRepo.findAll(req.home.id, filters));
  } catch (err) { next(err); }
});

router.get('/:id', readRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'read'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid ID' });
    const result = await dpiaRepo.findById(idP.data, req.home.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const result = await dpiaRepo.create(req.home.id, { ...parsed.data, created_by: req.user.username });
    await auditService.log('dpia_create', req.home.slug, req.user.username, { id: result.id, title: result.title });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await dpiaRepo.findById(idP.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    // Enforce status workflow: approved requires completed first
    if (parsed.data.status === 'approved' && existing.status !== 'completed') {
      return res.status(400).json({ error: 'DPIA must be completed before it can be approved' });
    }
    const version = Number.isFinite(parsed.data._version) ? parsed.data._version : null;
    const result = await dpiaRepo.update(idP.data, req.home.id, parsed.data, null, version);
    if (result === null) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    await auditService.log('dpia_update', req.home.slug, req.user.username, { id: idP.data, changes: diffFields(existing, result) });
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid ID' });
    const result = await dpiaRepo.softDelete(idP.data, req.home.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    await auditService.log('dpia_delete', req.home.slug, req.user.username, { id: idP.data });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

export default router;
