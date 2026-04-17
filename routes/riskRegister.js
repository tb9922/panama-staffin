import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import * as riskRepo from '../repositories/riskRepo.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { nullableDateInput } from '../lib/zodHelpers.js';
import { splitVersion } from '../lib/versionedPayload.js';
import { validateRiskStatusChange } from '../lib/statusTransitions.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const dateSchema = nullableDateInput;

const riskBodySchema = z.object({
  title:                z.string().min(1).max(500),
  description:          z.string().max(5000).nullable().optional(),
  category:             z.enum(['staffing', 'clinical', 'operational', 'financial', 'compliance']),
  owner:                z.string().max(200).nullable().optional(),
  likelihood:           z.coerce.number().int().min(1).max(5).nullable().optional(),
  impact:               z.coerce.number().int().min(1).max(5).nullable().optional(),
  controls:             z.array(z.object({
    description:   z.string().max(2000),
    effectiveness: z.string().max(100).nullable().optional(),
  })).max(100).optional(),
  residual_likelihood:  z.coerce.number().int().min(1).max(5).nullable().optional(),
  residual_impact:      z.coerce.number().int().min(1).max(5).nullable().optional(),
  actions:              z.array(z.object({
    description:    z.string().max(2000),
    owner:          z.string().max(200).nullable().optional(),
    due_date:       dateSchema.optional(),
    status:         z.enum(['open', 'in_progress', 'completed', 'overdue']).nullable().optional(),
    completed_date: dateSchema.optional(),
  })).max(100).optional(),
  last_reviewed:        dateSchema.optional(),
  next_review:          dateSchema.optional(),
  status:               z.enum(['open', 'mitigated', 'accepted', 'closed']).nullable().optional(),
});
const riskUpdateSchema = riskBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

// GET /api/risk-register?home=X
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'read'), async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const risksResult = await riskRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset });
    res.json({ risks: risksResult.rows, _total: risksResult.total });
  } catch (err) { next(err); }
});

// POST /api/risk-register?home=X
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const parsed = riskBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    parsed.data.inherent_risk = (parsed.data.likelihood ?? 0) * (parsed.data.impact ?? 0);
    parsed.data.residual_risk = (parsed.data.residual_likelihood ?? 0) * (parsed.data.residual_impact ?? 0);
    const risk = await riskRepo.upsert(req.home.id, parsed.data);
    await auditService.log('risk_create', req.home.slug, req.user.username, { id: risk?.id });
    res.status(201).json(risk);
  } catch (err) { next(err); }
});

// PUT /api/risk-register/:id?home=X
router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = riskUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await riskRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const statusError = validateRiskStatusChange(existing, parsed.data);
    if (statusError) return res.status(400).json({ error: statusError });
    const { version, payload } = splitVersion(parsed.data);
    const likelihood = payload.likelihood ?? existing.likelihood ?? 0;
    const impact = payload.impact ?? existing.impact ?? 0;
    const residualLikelihood = payload.residual_likelihood ?? existing.residual_likelihood ?? 0;
    const residualImpact = payload.residual_impact ?? existing.residual_impact ?? 0;
    payload.inherent_risk = likelihood * impact;
    payload.residual_risk = residualLikelihood * residualImpact;
    const risk = await riskRepo.update(idParsed.data, req.home.id, payload, version);
    if (risk === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, risk);
    await auditService.log('risk_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
    res.json(risk);
  } catch (err) { next(err); }
});

// DELETE /api/risk-register/:id?home=X
router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
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
