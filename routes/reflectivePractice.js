import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../errors.js';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { requiredDateInput, nullableDateInput } from '../lib/zodHelpers.js';
import { definedWithoutVersion, splitVersion } from '../lib/versionedPayload.js';
import * as reflectivePracticeRepo from '../repositories/reflectivePracticeRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();
const idSchema = z.coerce.number().int().positive();

const reflectivePracticeSchema = z.object({
  staff_id: z.string().trim().min(1).max(20).nullable().optional(),
  practice_date: requiredDateInput,
  facilitator: z.string().trim().max(200).nullable().optional(),
  category: z.string().trim().min(1).max(100).default('reflective_practice'),
  topic: z.string().trim().min(1).max(300),
  reflection: z.string().max(5000).nullable().optional(),
  learning_outcome: z.string().max(5000).nullable().optional(),
  wellbeing_notes: z.string().max(5000).nullable().optional(),
  action_summary: z.string().max(5000).nullable().optional(),
});

const reflectivePracticeUpdateSchema = reflectivePracticeSchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

const listSchema = paginationSchema.extend({
  staff_id: z.string().trim().max(20).optional(),
  from: nullableDateInput.optional(),
  to: nullableDateInput.optional(),
});

function actorId(req) {
  return req.authDbUser?.id || null;
}

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);
    const result = await reflectivePracticeRepo.findByHome(req.home.id, parsed.data);
    res.json({ entries: result.rows, _total: result.total });
  } catch (err) { next(err); }
});

router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    const parsed = reflectivePracticeSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const entry = await reflectivePracticeRepo.create(req.home.id, parsed.data, actorId(req));
    await auditService.log('reflective_practice_create', req.home.slug, req.user.username, { id: entry.id, staff_id: entry.staff_id });
    res.status(201).json(entry);
  } catch (err) { next(err); }
});

router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid reflective practice ID' });
    const parsed = reflectivePracticeUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await reflectivePracticeRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Reflective practice entry not found' });
    const { version } = splitVersion(parsed.data);
    const updates = definedWithoutVersion(parsed.data);
    const entry = await reflectivePracticeRepo.update(idParsed.data, req.home.id, updates, version, actorId(req));
    if (entry === null) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    await auditService.log('reflective_practice_update', req.home.slug, req.user.username, { id: entry.id });
    res.json(entry);
  } catch (err) { next(err); }
});

router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid reflective practice ID' });
    const deleted = await reflectivePracticeRepo.softDelete(idParsed.data, req.home.id, actorId(req));
    if (!deleted) return res.status(404).json({ error: 'Reflective practice entry not found' });
    await auditService.log('reflective_practice_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
