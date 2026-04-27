import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../errors.js';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { requiredDateInput, nullableDateInput } from '../lib/zodHelpers.js';
import { definedWithoutVersion, splitVersion } from '../lib/versionedPayload.js';
import { diffFields } from '../lib/audit.js';
import * as agencyAttemptRepo from '../repositories/agencyAttemptRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();
const idSchema = z.coerce.number().int().positive();
const attemptOutcomes = ['pending', 'internal_cover_found', 'no_viable_internal', 'emergency_agency', 'agency_used', 'agency_not_approved'];

const attemptBodySchema = z.object({
  gap_date: requiredDateInput,
  shift_code: z.enum(['AG-E', 'AG-L', 'AG-N']),
  role_needed: z.string().trim().max(100).nullable().optional(),
  reason: z.string().trim().min(1).max(1000),
  overtime_offered: z.boolean().optional().default(false),
  overtime_accepted: z.boolean().optional().default(false),
  overtime_refused: z.boolean().optional().default(false),
  internal_bank_checked: z.boolean().optional().default(false),
  internal_bank_candidate_count: z.number().int().min(0).max(10000).optional().default(0),
  viable_internal_candidate_count: z.number().int().min(0).max(10000).optional().default(0),
  emergency_override: z.boolean().optional().default(false),
  emergency_override_reason: z.string().trim().max(1000).nullable().optional(),
  outcome: z.enum(attemptOutcomes).optional(),
  notes: z.string().max(5000).nullable().optional(),
});

const attemptUpdateSchema = attemptBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

const listSchema = paginationSchema.extend({
  from: nullableDateInput.optional(),
  to: nullableDateInput.optional(),
  emergency_override: z.enum(['true', 'false']).optional(),
});

function actorId(req) {
  return req.authDbUser?.id || null;
}

function validateAttemptPayload(data, res) {
  if (data.emergency_override === true && !data.emergency_override_reason) {
    res.status(400).json({ error: 'Emergency override reason is required' });
    return false;
  }
  if (data.overtime_accepted === true && data.viable_internal_candidate_count > 0) {
    res.status(400).json({ error: 'Overtime accepted and viable internal candidates cannot both drive an agency attempt' });
    return false;
  }
  return true;
}

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read'), async (req, res, next) => {
  try {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);
    const result = await agencyAttemptRepo.findByHome(req.home.id, parsed.data);
    res.json({ attempts: result.rows, _total: result.total });
  } catch (err) { next(err); }
});

router.get('/:id', readRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'read'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid attempt ID' });
    const attempt = await agencyAttemptRepo.findById(idParsed.data, req.home.id);
    if (!attempt) return res.status(404).json({ error: 'Agency approval attempt not found' });
    res.json(attempt);
  } catch (err) { next(err); }
});

router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const parsed = attemptBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    if (!validateAttemptPayload(parsed.data, res)) return;

    const attempt = await agencyAttemptRepo.create(req.home.id, {
      ...parsed.data,
      checked_by: actorId(req),
    });
    await auditService.log('agency_attempt_create', req.home.slug, req.user.username, {
      id: attempt.id,
      emergency_override: attempt.emergency_override,
      viable_internal_candidate_count: attempt.viable_internal_candidate_count,
    });
    res.status(201).json(attempt);
  } catch (err) { next(err); }
});

router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid attempt ID' });
    const parsed = attemptUpdateSchema.safeParse(req.body);
    const existing = await agencyAttemptRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Agency approval attempt not found' });
    if (!parsed.success) return zodError(res, parsed);
    if (!validateAttemptPayload({ ...existing, ...parsed.data }, res)) return;
    const { version } = splitVersion(parsed.data);
    const updates = definedWithoutVersion(parsed.data);
    const attempt = await agencyAttemptRepo.update(idParsed.data, req.home.id, updates, version);
    if (attempt === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, attempt, { extraSensitive: ['reason', 'emergency_override_reason', 'notes'] });
    await auditService.log('agency_attempt_update', req.home.slug, req.user.username, { id: attempt.id, changes });
    res.json(attempt);
  } catch (err) { next(err); }
});

export default router;
