import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as riskRepo from '../repositories/riskRepo.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';

const router = Router();
router.use(writeRateLimiter);
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
  })).max(100).optional(),
  residual_likelihood:  z.coerce.number().int().min(1).max(5).nullable().optional(),
  residual_impact:      z.coerce.number().int().min(1).max(5).nullable().optional(),
  residual_risk:        z.coerce.number().int().min(1).max(25).nullable().optional(),
  actions:              z.array(z.object({
    description:    z.string().max(2000),
    owner:          z.string().max(200).nullable().optional(),
    due_date:       dateSchema.optional(),
    status:         z.string().max(50).nullable().optional(),
    completed_date: dateSchema.optional(),
  })).max(100).optional(),
  last_reviewed:        dateSchema.optional(),
  next_review:          dateSchema.optional(),
  status:               z.string().max(50).nullable().optional(),
});
const riskUpdateSchema = riskBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

// GET /api/risk-register?home=X
router.get('/', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const risksResult = await riskRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset });
    res.json({ risks: risksResult.rows, _total: risksResult.total });
  } catch (err) { next(err); }
});

// POST /api/risk-register?home=X
router.post('/', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = riskBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const risk = await riskRepo.upsert(req.home.id, parsed.data);
    await auditService.log('risk_create', req.home.slug, req.user.username, { id: risk?.id });
    res.status(201).json(risk);
  } catch (err) { next(err); }
});

// PUT /api/risk-register/:id?home=X
router.put('/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = riskUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await riskRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const version = parsed.data._version != null ? parsed.data._version : null;
    const risk = await riskRepo.update(idParsed.data, req.home.id, parsed.data, version);
    if (risk === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, risk);
    await auditService.log('risk_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
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
    await auditService.log('risk_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
