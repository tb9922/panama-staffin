import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../errors.js';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { splitVersion } from '../lib/versionedPayload.js';
import * as auditService from '../services/auditService.js';
import * as cqcEvidenceLinksRepo from '../repositories/cqcEvidenceLinksRepo.js';
import { ALLOWED_CQC_EVIDENCE_CATEGORY_VALUES } from '../src/lib/cqcEvidenceCategories.js';

const router = Router();

const SOURCE_MODULES = [
  'incident',
  'complaint',
  'training_record',
  'supervision',
  'appraisal',
  'fire_drill',
  'ipc_audit',
  'maintenance',
  'risk',
  'policy_review',
  'whistleblowing',
  'dols',
  'mca_assessment',
  'cqc_evidence',
  'cqc_partner_feedback',
  'cqc_observation',
  'handover',
  'onboarding',
  'care_certificate',
  'hr_disciplinary',
  'hr_grievance',
  'hr_performance',
];

const idSchema = z.coerce.number().int().positive();
const statementIdSchema = z.string().regex(/^(S[1-8]|E[1-6]|C[1-5]|R[1-7]|WL[1-8])$/);
const sourceModuleSchema = z.enum(SOURCE_MODULES);
const evidenceCategorySchema = z.enum(ALLOWED_CQC_EVIDENCE_CATEGORY_VALUES);
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sourceRecordedAtSchema = z.union([dateOnlySchema, z.string().datetime({ offset: true })]);

const listQuerySchema = paginationSchema.extend({
  statement: statementIdSchema.optional(),
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
});

const countsQuerySchema = z.object({
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
});

const createLinkSchema = z.object({
  source_module: sourceModuleSchema,
  source_id: z.string().min(1).max(50),
  quality_statement: statementIdSchema,
  evidence_category: evidenceCategorySchema,
  rationale: z.string().max(2000).nullable().optional(),
  source_recorded_at: sourceRecordedAtSchema.optional(),
});

const bulkCreateSchema = z.object({
  links: z.array(createLinkSchema).min(1).max(50),
});

const updateLinkSchema = z.object({
  rationale: z.string().max(2000).nullable().optional(),
  requires_review: z.boolean().optional(),
  source_recorded_at: sourceRecordedAtSchema.nullable().optional(),
  _version: z.number().int().nonnegative().optional(),
});

const confirmBulkSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
});

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);

    const { statement, dateFrom, dateTo, limit, offset } = parsed.data;
    const result = statement
      ? await cqcEvidenceLinksRepo.findByStatement(req.home.id, statement, { dateFrom, dateTo, limit, offset })
      : await cqcEvidenceLinksRepo.findByHome(req.home.id, { dateFrom, dateTo, limit, offset });

    res.json({ rows: result.rows, _total: result.total });
  } catch (err) {
    next(err);
  }
});

router.get('/source/:module/:id', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const moduleParsed = sourceModuleSchema.safeParse(req.params.module);
    if (!moduleParsed.success) return res.status(400).json({ error: 'Invalid source module' });
    const sourceId = String(req.params.id || '');
    if (!sourceId) return res.status(400).json({ error: 'Invalid source ID' });

    const rows = await cqcEvidenceLinksRepo.findBySource(req.home.id, moduleParsed.data, sourceId);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/counts', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const parsed = countsQuerySchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);
    const rows = await cqcEvidenceLinksRepo.countByStatement(req.home.id, parsed.data);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = createLinkSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);

    const saved = await cqcEvidenceLinksRepo.createLink(req.home.id, {
      ...parsed.data,
      auto_linked: false,
      requires_review: false,
      linked_by: req.user.username,
    });

    await auditService.log('cqc_evidence_link_create', req.home.slug, req.user.username, {
      id: saved?.id,
      source_module: saved?.sourceModule,
      source_id: saved?.sourceId,
      quality_statement: saved?.qualityStatement,
      evidence_category: saved?.evidenceCategory,
    });
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
});

router.post('/bulk', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = bulkCreateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);

    const saved = await cqcEvidenceLinksRepo.createBulkLinks(
      req.home.id,
      parsed.data.links.map((link) => ({
        ...link,
        auto_linked: false,
        requires_review: false,
        linked_by: req.user.username,
      }))
    );

    await auditService.log('cqc_evidence_link_bulk_create', req.home.slug, req.user.username, {
      count: saved.length,
      source_modules: [...new Set(saved.map((entry) => entry.sourceModule))],
    });
    res.status(201).json({ links: saved });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });

    const parsed = updateLinkSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);

    const existing = await cqcEvidenceLinksRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { version, payload } = splitVersion(parsed.data);
    const saved = await cqcEvidenceLinksRepo.updateLink(idParsed.data, req.home.id, payload, version);
    if (saved === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }

    await auditService.log('cqc_evidence_link_update', req.home.slug, req.user.username, {
      id: idParsed.data,
      before: existing,
      after: saved,
    });
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });

    const existing = await cqcEvidenceLinksRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    await cqcEvidenceLinksRepo.softDelete(idParsed.data, req.home.id);
    await auditService.log('cqc_evidence_link_delete', req.home.slug, req.user.username, {
      id: idParsed.data,
      source_module: existing.sourceModule,
      source_id: existing.sourceId,
      quality_statement: existing.qualityStatement,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/confirm', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });

    const existing = await cqcEvidenceLinksRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const saved = await cqcEvidenceLinksRepo.confirmAutoLink(idParsed.data, req.home.id, req.user.username);
    await auditService.log('cqc_evidence_link_confirm', req.home.slug, req.user.username, {
      id: idParsed.data,
      source_module: existing.sourceModule,
      source_id: existing.sourceId,
      quality_statement: existing.qualityStatement,
    });
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

router.post('/confirm-bulk', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = confirmBulkSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);

    const rows = await cqcEvidenceLinksRepo.confirmBulkAutoLinks(req.home.id, parsed.data.ids, req.user.username);
    await auditService.log('cqc_evidence_link_confirm_bulk', req.home.slug, req.user.username, {
      count: rows.length,
      ids: rows.map((row) => row.id),
    });
    res.json({ links: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
