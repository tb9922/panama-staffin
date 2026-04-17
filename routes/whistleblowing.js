import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import * as whistleblowingRepo from '../repositories/whistleblowingRepo.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { nullableDateInput } from '../lib/zodHelpers.js';
import { splitVersion } from '../lib/versionedPayload.js';
import { validateWhistleblowingStatusChange } from '../lib/statusTransitions.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const dateSchema = nullableDateInput;

const concernBodySchema = z.object({
  date_raised:              dateSchema,
  raised_by_role:           z.string().max(200).nullable().optional(),
  anonymous:                z.boolean().optional(),
  category:                 z.enum(['malpractice', 'bullying', 'safety', 'compliance', 'other']),
  description:              z.string().max(10000).nullable().optional(),
  severity:                 z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status:                   z.enum(['registered', 'investigating', 'resolved', 'closed']).nullable().optional(),
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
const concernUpdateSchema = concernBodySchema.omit({ anonymous: true }).partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

// GET /api/whistleblowing?home=X
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'read'), async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const concernsResult = await whistleblowingRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset });
    const concerns = concernsResult.rows;
    const isAdmin = req.homeRole === 'home_manager' || req.homeRole === 'deputy_manager';
    // Strip raised_by_role from anonymous concerns to prevent de-anonymisation
    // Strip investigation details for non-admin viewers (GDPR)
    const safe = concerns.map(c => {
      const stripped = { ...c };
      if (c.anonymous) delete stripped.raised_by_role;
      if (!isAdmin) {
        delete stripped.investigator;
        delete stripped.investigation_start_date;
        delete stripped.findings;
        delete stripped.outcome_details;
        delete stripped.protection_details;
        delete stripped.lessons_learned;
      }
      return stripped;
    });
    res.json({ concerns: safe, _total: concernsResult.total });
  } catch (err) { next(err); }
});

// POST /api/whistleblowing?home=X
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const parsed = concernBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const createData = { ...parsed.data };
    // Strip identifying info when concern is anonymous
    if (createData.anonymous) {
      delete createData.raised_by_role;
    }
    const concern = await whistleblowingRepo.upsert(req.home.id, createData);
    await auditService.log('whistleblowing_create', req.home.slug, req.user.username, { id: concern?.id });
    const safe = concern.anonymous ? (({ raised_by_role: _raised_by_role, ...rest }) => rest)(concern) : concern;
    res.status(201).json(safe);
  } catch (err) { next(err); }
});

// PUT /api/whistleblowing/:id?home=X
router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = concernUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await whistleblowingRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { version, payload } = splitVersion(parsed.data);
    const updateData = { ...payload };
    const statusError = validateWhistleblowingStatusChange(existing, updateData);
    if (statusError) return res.status(400).json({ error: statusError });
    // Prevent de-anonymisation: never overwrite raised_by_role on anonymous concerns
    if (existing.anonymous) delete updateData.raised_by_role;
    const concern = await whistleblowingRepo.update(idParsed.data, req.home.id, updateData, version);
    if (concern === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    let changes = diffFields(existing, concern);
    // Strip raised_by_role from audit diff for anonymous concerns to prevent de-anonymisation
    if (concern.anonymous) {
      changes = changes.filter(c => c.field !== 'raised_by_role');
    }
    await auditService.log('whistleblowing_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
    const safe = concern.anonymous ? (({ raised_by_role: _raised_by_role, ...rest }) => rest)(concern) : concern;
    res.json(safe);
  } catch (err) { next(err); }
});

// DELETE /api/whistleblowing/:id?home=X
router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
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
