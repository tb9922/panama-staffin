import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../errors.js';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { requiredDateInput, nullableDateInput } from '../lib/zodHelpers.js';
import { definedWithoutVersion, splitVersion } from '../lib/versionedPayload.js';
import { buildAuditTasksForRange } from '../lib/auditTaskTemplates.js';
import * as auditTaskRepo from '../repositories/auditTaskRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();
const idSchema = z.coerce.number().int().positive();

const taskBodySchema = z.object({
  template_key: z.string().trim().max(200).nullable().optional(),
  title: z.string().trim().min(1).max(300),
  category: z.string().trim().min(1).max(100).default('governance'),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc']).default('ad_hoc'),
  period_start: nullableDateInput.optional(),
  period_end: nullableDateInput.optional(),
  due_date: requiredDateInput,
  owner_user_id: z.coerce.number().int().positive().nullable().optional(),
  status: z.enum(['open', 'completed', 'verified', 'cancelled']).default('open'),
  evidence_required: z.boolean().optional().default(true),
  evidence_notes: z.string().max(5000).nullable().optional(),
});

const taskUpdateSchema = taskBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

const completeSchema = z.object({
  _version: z.number().int().nonnegative().optional(),
  evidence_notes: z.string().max(5000).nullable().optional(),
});

const generateSchema = z.object({
  from: requiredDateInput.optional(),
  to: requiredDateInput.optional(),
});

const listSchema = paginationSchema.extend({
  status: z.enum(['open', 'completed', 'verified', 'cancelled']).optional(),
  category: z.string().max(100).optional(),
  from: nullableDateInput.optional(),
  to: nullableDateInput.optional(),
});

function actorId(req) {
  return req.authDbUser?.id || null;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function defaultGenerateRange() {
  const today = new Date();
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 35);
  return { from: dateOnly(from), to: dateOnly(to) };
}

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'read'), async (req, res, next) => {
  try {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);
    const result = await auditTaskRepo.findByHome(req.home.id, parsed.data);
    res.json({ tasks: result.rows, _total: result.total });
  } catch (err) { next(err); }
});

router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const parsed = taskBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const task = await auditTaskRepo.create(req.home.id, { ...parsed.data, actor_id: actorId(req) });
    await auditService.log('audit_task_create', req.home.slug, req.user.username, { id: task.id, frequency: task.frequency });
    res.status(201).json(task);
  } catch (err) { next(err); }
});

router.post('/generate', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const parsed = generateSchema.safeParse(req.body || {});
    if (!parsed.success) return zodError(res, parsed);
    const defaults = defaultGenerateRange();
    const range = {
      from: parsed.data.from || defaults.from,
      to: parsed.data.to || defaults.to,
    };
    const tasks = buildAuditTasksForRange(range);
    const inserted = await auditTaskRepo.createGenerated(req.home.id, tasks, actorId(req));
    await auditService.log('audit_task_generate', req.home.slug, req.user.username, {
      from: range.from,
      to: range.to,
      planned: tasks.length,
      inserted: inserted.length,
    });
    res.status(201).json({ tasks: inserted, planned: tasks.length, inserted: inserted.length, range });
  } catch (err) { next(err); }
});

router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid task ID' });
    const parsed = taskUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await auditTaskRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Audit task not found' });
    const { version } = splitVersion(parsed.data);
    const task = await auditTaskRepo.update(idParsed.data, req.home.id, definedWithoutVersion(parsed.data), version, actorId(req));
    if (task === null) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    await auditService.log('audit_task_update', req.home.slug, req.user.username, { id: task.id });
    res.json(task);
  } catch (err) { next(err); }
});

router.post('/:id/complete', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid task ID' });
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await auditTaskRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Audit task not found' });
    const { version } = splitVersion(parsed.data);
    const task = await auditTaskRepo.complete(idParsed.data, req.home.id, actorId(req), parsed.data.evidence_notes, version);
    if (task === null) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    await auditService.log('audit_task_complete', req.home.slug, req.user.username, { id: task.id });
    res.json(task);
  } catch (err) { next(err); }
});

router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid task ID' });
    const deleted = await auditTaskRepo.softDelete(idParsed.data, req.home.id, actorId(req));
    if (!deleted) return res.status(404).json({ error: 'Audit task not found' });
    await auditService.log('audit_task_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
