import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as cqcEvidenceRepo from '../repositories/cqcEvidenceRepo.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const evidenceBodySchema = z.object({
  quality_statement: z.string().min(1).max(20).regex(/^(S[1-8]|E[1-6]|C[1-5]|R[1-5]|WL([1-9]|10))$/),
  type:              z.enum(['quantitative', 'qualitative']),
  title:             z.string().min(1).max(500),
  description:       z.string().max(10000).nullable().optional(),
  date_from:         dateSchema.optional(),
  date_to:           dateSchema.optional(),
});
const evidenceUpdateSchema = evidenceBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

// GET /api/cqc-evidence?home=X
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const evidenceResult = await cqcEvidenceRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset });
    res.json({ evidence: evidenceResult.rows, _total: evidenceResult.total });
  } catch (err) { next(err); }
});

// POST /api/cqc-evidence?home=X
router.post('/', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = evidenceBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const item = await cqcEvidenceRepo.upsert(req.home.id, { ...parsed.data, added_by: req.user.username });
    await auditService.log('cqc_evidence_create', req.home.slug, req.user.username, { id: item?.id });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

// PUT /api/cqc-evidence/:id?home=X
router.put('/:id', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = evidenceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await cqcEvidenceRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const version = parsed.data._version != null ? parsed.data._version : null;
    const item = await cqcEvidenceRepo.update(idParsed.data, req.home.id, parsed.data, version);
    if (item === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, item);
    await auditService.log('cqc_evidence_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
    res.json(item);
  } catch (err) { next(err); }
});

// DELETE /api/cqc-evidence/:id?home=X
router.delete('/:id', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await cqcEvidenceRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await auditService.log('cqc_evidence_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
