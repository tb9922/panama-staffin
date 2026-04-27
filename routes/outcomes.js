import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../errors.js';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { requiredDateInput, nullableDateInput } from '../lib/zodHelpers.js';
import { splitVersion, definedWithoutVersion } from '../lib/versionedPayload.js';
import * as outcomeMetricRepo from '../repositories/outcomeMetricRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();
const idSchema = z.coerce.number().int().positive();

const metricSchema = z.object({
  metric_key: z.string().trim().min(1).max(100),
  period_start: requiredDateInput,
  period_end: requiredDateInput,
  numerator: z.number().nullable().optional(),
  denominator: z.number().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

const metricUpdateSchema = metricSchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

const dashboardQuerySchema = z.object({
  from: nullableDateInput.optional(),
  to: nullableDateInput.optional(),
});

function actorId(req) {
  return req.authDbUser?.id || null;
}

router.get('/dashboard', readRateLimiter, requireAuth, requireHomeAccess, requireModule('reports', 'read'), async (req, res, next) => {
  try {
    const parsed = dashboardQuerySchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);
    const [derived, manual] = await Promise.all([
      outcomeMetricRepo.getDerivedMetrics(req.home.id, parsed.data),
      outcomeMetricRepo.findManualMetrics(req.home.id, parsed.data),
    ]);
    res.json({
      generated_at: new Date().toISOString(),
      derived,
      manual,
    });
  } catch (err) { next(err); }
});

router.get('/metrics', readRateLimiter, requireAuth, requireHomeAccess, requireModule('reports', 'read'), async (req, res, next) => {
  try {
    const parsed = dashboardQuerySchema.extend({ metric_key: z.string().max(100).optional() }).safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);
    res.json({ metrics: await outcomeMetricRepo.findManualMetrics(req.home.id, parsed.data) });
  } catch (err) { next(err); }
});

router.post('/metrics', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const parsed = metricSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    if (parsed.data.period_end < parsed.data.period_start) {
      return res.status(400).json({ error: 'Period end must be on or after period start' });
    }
    const metric = await outcomeMetricRepo.upsert(req.home.id, parsed.data, actorId(req));
    await auditService.log('outcome_metric_upsert', req.home.slug, req.user.username, { id: metric.id, metric_key: metric.metric_key });
    res.status(201).json(metric);
  } catch (err) { next(err); }
});

router.put('/metrics/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid metric ID' });
    const parsed = metricUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await outcomeMetricRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Outcome metric not found' });
    const { version } = splitVersion(parsed.data);
    const updates = definedWithoutVersion(parsed.data);
    if ((updates.period_start || updates.period_end) && (updates.period_end || existing.period_end) < (updates.period_start || existing.period_start)) {
      return res.status(400).json({ error: 'Period end must be on or after period start' });
    }
    const metric = await outcomeMetricRepo.update(idParsed.data, req.home.id, updates, version, actorId(req));
    if (metric === null) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    await auditService.log('outcome_metric_update', req.home.slug, req.user.username, { id: metric.id });
    res.json(metric);
  } catch (err) { next(err); }
});

router.delete('/metrics/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid metric ID' });
    const deleted = await outcomeMetricRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Outcome metric not found' });
    await auditService.log('outcome_metric_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
