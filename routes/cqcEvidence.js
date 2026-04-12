import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { createReadStream, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { fileTypeFromFile } from 'file-type';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import * as cqcEvidenceRepo from '../repositories/cqcEvidenceRepo.js';
import * as cqcEvidenceFileRepo from '../repositories/cqcEvidenceFileRepo.js';
import * as cqcNarrativeRepo from '../repositories/cqcNarrativeRepo.js';
import * as cqcPartnerFeedbackRepo from '../repositories/cqcPartnerFeedbackRepo.js';
import * as cqcObservationRepo from '../repositories/cqcObservationRepo.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { nullableDateInput } from '../lib/zodHelpers.js';
import { config } from '../config.js';
import { splitVersion } from '../lib/versionedPayload.js';
import { ALLOWED_CQC_EVIDENCE_CATEGORY_VALUES } from '../src/lib/cqcEvidenceCategories.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const statementIdSchema = z.string().regex(/^(S[1-8]|E[1-6]|C[1-5]|R[1-5]|WL([1-9]|10))$/);
const dateSchema = nullableDateInput;
const blankToNull = (value) => (value === '' ? null : value);
const nullableShortText = z.preprocess(blankToNull, z.string().max(200).nullable());
const nullableDateTimeInput = z.preprocess(blankToNull, z.string().datetime({ offset: true }).nullable());
const nullableLongText = z.preprocess(blankToNull, z.string().max(10000).nullable());

function safePath(segment) {
  return String(segment || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const evidenceId = safePath(req.params.id);
    if (!evidenceId) return cb(new Error('Invalid evidence ID'));
    const dir = path.join(config.upload.dir, String(req.home.id), 'cqc_evidence', evidenceId);
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, crypto.randomUUID() + ext);
  },
});

function fileFilter(req, file, cb) {
  if (config.upload.allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} not allowed`));
  }
}

const upload = multer({ storage, fileFilter, limits: { fileSize: config.upload.maxFileSize } });

const evidenceBodySchema = z.object({
  quality_statement: statementIdSchema,
  type: z.enum(['quantitative', 'qualitative']),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).nullable().optional(),
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
  evidence_category: z.enum(ALLOWED_CQC_EVIDENCE_CATEGORY_VALUES).optional(),
  evidence_owner: nullableShortText.optional(),
  review_due: dateSchema.optional(),
});
const evidenceUpdateSchema = evidenceBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

const partnerFeedbackBodySchema = z.object({
  quality_statement: statementIdSchema,
  feedback_date: dateSchema,
  title: z.string().min(1).max(500),
  partner_name: nullableShortText.optional(),
  partner_role: nullableShortText.optional(),
  relationship: nullableShortText.optional(),
  summary: nullableLongText.optional(),
  response_action: nullableLongText.optional(),
  evidence_owner: nullableShortText.optional(),
  review_due: dateSchema.optional(),
});
const partnerFeedbackUpdateSchema = partnerFeedbackBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

const observationBodySchema = z.object({
  quality_statement: statementIdSchema,
  observed_at: nullableDateTimeInput.refine((value) => value != null, { message: 'Observed at is required' }),
  title: z.string().min(1).max(500),
  area: nullableShortText.optional(),
  observer: nullableShortText.optional(),
  notes: nullableLongText.optional(),
  actions: nullableLongText.optional(),
  evidence_owner: nullableShortText.optional(),
  review_due: dateSchema.optional(),
});
const observationUpdateSchema = observationBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

const narrativeBodySchema = z.object({
  narrative: nullableLongText.optional(),
  risks: nullableLongText.optional(),
  actions: nullableLongText.optional(),
  reviewed_by: nullableShortText.optional(),
  reviewed_at: nullableDateTimeInput.optional(),
  review_due: dateSchema.optional(),
  _version: z.number().int().nonnegative().optional(),
});

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const evidenceResult = await cqcEvidenceRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset });
    res.json({ evidence: evidenceResult.rows, _total: evidenceResult.total });
  } catch (err) {
    next(err);
  }
});

router.get('/narratives', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const rows = await cqcNarrativeRepo.findByHome(req.home.id);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/partner-feedback', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const rows = await cqcPartnerFeedbackRepo.findByHome(req.home.id);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/observations', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const rows = await cqcObservationRepo.findByHome(req.home.id);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = evidenceBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const item = await cqcEvidenceRepo.upsert(req.home.id, { ...parsed.data, added_by: req.user.username });
    await auditService.log('cqc_evidence_create', req.home.slug, req.user.username, { id: item?.id });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.post('/partner-feedback', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = partnerFeedbackBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const item = await cqcPartnerFeedbackRepo.create(req.home.id, {
      ...parsed.data,
      added_by: req.user.username,
    });
    await auditService.log('cqc_partner_feedback_create', req.home.slug, req.user.username, { id: item?.id, quality_statement: item?.quality_statement });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.post('/observations', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = observationBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const item = await cqcObservationRepo.create(req.home.id, {
      ...parsed.data,
      added_by: req.user.username,
    });
    await auditService.log('cqc_observation_create', req.home.slug, req.user.username, { id: item?.id, quality_statement: item?.quality_statement });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.put('/narratives/:statementId', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const statementParsed = statementIdSchema.safeParse(req.params.statementId);
    if (!statementParsed.success) return res.status(400).json({ error: 'Invalid statement ID' });
    const parsed = narrativeBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);

    const existing = await cqcNarrativeRepo.findByStatement(req.home.id, statementParsed.data);
    const { version, payload } = splitVersion(parsed.data);
    const saved = await cqcNarrativeRepo.upsert(req.home.id, statementParsed.data, payload, version);
    if (saved === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = existing ? diffFields(existing, saved) : { created: true };
    await auditService.log('cqc_narrative_update', req.home.slug, req.user.username, {
      quality_statement: statementParsed.data,
      changes,
    });
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

router.put('/partner-feedback/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = partnerFeedbackUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await cqcPartnerFeedbackRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { version, payload } = splitVersion(parsed.data);
    const saved = await cqcPartnerFeedbackRepo.update(idParsed.data, req.home.id, payload, version);
    if (saved === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    await auditService.log('cqc_partner_feedback_update', req.home.slug, req.user.username, {
      id: idParsed.data,
      changes: diffFields(existing, saved),
    });
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

router.put('/observations/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = observationUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await cqcObservationRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { version, payload } = splitVersion(parsed.data);
    const saved = await cqcObservationRepo.update(idParsed.data, req.home.id, payload, version);
    if (saved === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    await auditService.log('cqc_observation_update', req.home.slug, req.user.username, {
      id: idParsed.data,
      changes: diffFields(existing, saved),
    });
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = evidenceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await cqcEvidenceRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { version, payload } = splitVersion(parsed.data);
    const item = await cqcEvidenceRepo.update(idParsed.data, req.home.id, payload, version);
    if (item === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, item);
    await auditService.log('cqc_evidence_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await cqcEvidenceRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await auditService.log('cqc_evidence_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/partner-feedback/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await cqcPartnerFeedbackRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await auditService.log('cqc_partner_feedback_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/observations/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await cqcObservationRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await auditService.log('cqc_observation_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/files', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const evidence = await cqcEvidenceRepo.findById(idParsed.data, req.home.id);
    if (!evidence) return res.status(404).json({ error: 'Evidence item not found' });
    const files = await cqcEvidenceFileRepo.findByEvidence(req.home.id, idParsed.data);
    res.json(files);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/files', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const evidence = await cqcEvidenceRepo.findById(idParsed.data, req.home.id);
    if (!evidence) return res.status(404).json({ error: 'Evidence item not found' });
    upload.single('file')(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 20MB)' });
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      try {
        const detected = await fileTypeFromFile(req.file.path);
        if (detected && detected.mime !== req.file.mimetype) {
          await unlink(req.file.path).catch(() => {});
          return res.status(400).json({ error: 'File content does not match declared type' });
        }
        const description = z.string().max(500).optional().safeParse(req.body.description);
        const attachment = await cqcEvidenceFileRepo.create(req.home.id, idParsed.data, {
          original_name: req.file.originalname,
          stored_name: req.file.filename,
          mime_type: req.file.mimetype,
          size_bytes: req.file.size,
          description: description.success ? (description.data || null) : null,
          uploaded_by: req.user.username,
        });
        await auditService.log('cqc_evidence_file_upload', req.home.slug, req.user.username, {
          evidenceId: idParsed.data,
          fileId: attachment.id,
        });
        res.status(201).json(attachment);
      } catch (uploadErr) {
        await unlink(req.file.path).catch(() => {});
        next(uploadErr);
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/files/:id/download', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid file ID' });
    const att = await cqcEvidenceFileRepo.findById(id, req.home.id);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    const uploadRoot = path.resolve(config.upload.dir);
    const filePath = path.resolve(path.join(
      config.upload.dir,
      String(req.home.id),
      'cqc_evidence',
      safePath(att.evidence_id),
      att.stored_name
    ));
    if (!filePath.startsWith(uploadRoot)) return res.status(403).json({ error: 'Forbidden' });
    const safeName = att.original_name.replace(/["\r\n;]/g, '_');
    res.set({
      'Content-Type': att.mime_type,
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Content-Length': att.size_bytes,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'X-Frame-Options': 'DENY',
    });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

router.delete('/files/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid file ID' });
    const deleted = await cqcEvidenceFileRepo.softDelete(id, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Attachment not found' });
    await auditService.log('cqc_evidence_file_delete', req.home.slug, req.user.username, {
      evidenceId: deleted.evidence_id,
      fileId: id,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
