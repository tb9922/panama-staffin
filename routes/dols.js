import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import * as dolsRepo from '../repositories/dolsRepo.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const dolsBodySchema = z.object({
  resident_name:          z.string().min(1).max(200),
  resident_id:            z.number().int().positive().nullable().optional(),
  dob:                    dateSchema.optional(),
  room_number:            z.string().max(50).nullable().optional(),
  application_type:       z.enum(['dols', 'lps']).optional(),
  application_date:       dateSchema,
  authorised:             z.boolean().optional(),
  authorisation_date:     dateSchema.optional(),
  expiry_date:            dateSchema.optional(),
  authorisation_number:   z.string().max(200).nullable().optional(),
  authorising_authority:  z.string().max(200).nullable().optional(),
  restrictions:           z.array(z.string().max(500)).max(50).optional(),
  reviewed_date:          dateSchema.optional(),
  review_status:          z.string().max(50).nullable().optional(),
  next_review_date:       dateSchema.optional(),
  notes:                  z.string().max(5000).nullable().optional(),
});
const dolsUpdateSchema = dolsBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

const mcaBodySchema = z.object({
  resident_name:          z.string().min(1).max(200),
  resident_id:            z.number().int().positive().nullable().optional(),
  assessment_date:        dateSchema,
  assessor:               z.string().max(200).nullable().optional(),
  decision_area:          z.string().max(500).nullable().optional(),
  lacks_capacity:         z.boolean().optional(),
  best_interest_decision: z.string().max(5000).nullable().optional(),
  next_review_date:       dateSchema.optional(),
  notes:                  z.string().max(5000).nullable().optional(),
});
const mcaUpdateSchema = mcaBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

// GET /api/dols?home=X — viewers (shift leads, seniors) need DoLS status for residents
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const [dolsResult, mcaResult] = await Promise.all([
      dolsRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset }),
      dolsRepo.findMcaByHome(req.home.id, { limit: pg.limit, offset: pg.offset }),
    ]);
    // Strip resident DoB for non-admin users (GDPR special category — not needed for care delivery)
    const isAdmin = req.homeRole === 'home_manager' || req.homeRole === 'deputy_manager';
    const dols = isAdmin ? dolsResult.rows : dolsResult.rows.map(({ dob: _dob, ...rest }) => rest);
    // Strip Article 9 mental-capacity fields for non-manager roles
    const mcaAssessments = isAdmin
      ? mcaResult.rows
      : mcaResult.rows.map(({ lacks_capacity: _lc, best_interest_decision: _bid, ...rest }) => rest);
    res.json({ dols, mcaAssessments, _total: dolsResult.total });
  } catch (err) { next(err); }
});

// POST /api/dols?home=X — create DoLS record
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = dolsBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const record = await dolsRepo.upsertDols(req.home.id, parsed.data);
    await auditService.log('dols_create', req.home.slug, req.user.username, { id: record?.id });
    res.status(201).json(record);
  } catch (err) { next(err); }
});

// PUT /api/dols/:id?home=X — update DoLS record
router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = dolsUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await dolsRepo.findDolsById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const version = parsed.data._version != null ? parsed.data._version : null;
    const record = await dolsRepo.updateDols(idParsed.data, req.home.id, parsed.data, version);
    if (record === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, record);
    await auditService.log('dols_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
    res.json(record);
  } catch (err) { next(err); }
});

// DELETE /api/dols/:id?home=X — soft delete DoLS record
router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await dolsRepo.softDeleteDols(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await auditService.log('dols_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/dols/mca?home=X — create MCA assessment
router.post('/mca', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = mcaBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const record = await dolsRepo.upsertMca(req.home.id, parsed.data);
    await auditService.log('mca_create', req.home.slug, req.user.username, { id: record?.id });
    res.status(201).json(record);
  } catch (err) { next(err); }
});

// PUT /api/dols/mca/:id?home=X — update MCA assessment
router.put('/mca/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = mcaUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await dolsRepo.findMcaById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const version = parsed.data._version != null ? parsed.data._version : null;
    const record = await dolsRepo.updateMca(idParsed.data, req.home.id, parsed.data, version);
    if (record === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, record);
    await auditService.log('mca_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
    res.json(record);
  } catch (err) { next(err); }
});

// DELETE /api/dols/mca/:id?home=X — soft delete MCA assessment
router.delete('/mca/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await dolsRepo.softDeleteMca(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await auditService.log('mca_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
