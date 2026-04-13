import { zodError } from '../errors.js';
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import { mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { fileTypeFromFile } from 'file-type';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { config } from '../config.js';
import * as trainingRepo from '../repositories/trainingRepo.js';
import * as trainingAttachmentsRepo from '../repositories/trainingAttachments.js';
import * as supervisionRepo from '../repositories/supervisionRepo.js';
import * as appraisalRepo from '../repositories/appraisalRepo.js';
import * as fireDrillRepo from '../repositories/fireDrillRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as auditService from '../services/auditService.js';
import { paginationSchema } from '../lib/pagination.js';
import { sendStoredDownload } from '../lib/sendDownload.js';
import { getTrainingTypes } from '../shared/training.js';
import { updateTrainingTypesConfig } from '../repositories/homeRepo.js';
import { nullableDateInput } from '../lib/zodHelpers.js';

const router = Router();
const recordIdSchema = z.string().min(1).max(100);
const dateSchema = nullableDateInput;
const staffIdSchema = z.string().min(1).max(20);
const typeIdSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const attachmentDescriptionSchema = z.string().max(5000).nullable().optional();

function safePath(segment) {
  return String(segment).replace(/[^a-zA-Z0-9_-]/g, '');
}

const attachmentStorage = multer.diskStorage({
  destination(req, file, cb) {
    const staffId = safePath(req.params.staffId);
    const typeId = safePath(req.params.typeId);
    if (!staffId || !typeId) return cb(new Error('Invalid path parameters'));
    const dir = path.join(config.upload.dir, String(req.home.id), 'training', staffId, typeId);
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `${randomUUID()}${ext}`);
  },
});

function attachmentFileFilter(req, file, cb) {
  if (config.upload.allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} not allowed`));
  }
}

const attachmentUpload = multer({
  storage: attachmentStorage,
  fileFilter: attachmentFileFilter,
  limits: { fileSize: config.upload.maxFileSize },
});

const trainingTypeSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  category: z.enum(['statutory', 'mandatory']),
  refresher_months: z.coerce.number().int().min(1).max(120).nullable(),
  roles: z.array(z.string().max(100)).max(50).nullable(),
  legislation: z.string().max(500).nullable().optional(),
  active: z.boolean(),
  levels: z.array(z.object({
    id: z.string().max(50),
    name: z.string().max(200),
    roles: z.array(z.string().max(100)).max(50).nullable().optional(),
  })).max(20).optional(),
});

const trainingTypesArraySchema = z.array(trainingTypeSchema).max(100);
const trainingTypesUpdateSchema = z.object({
  trainingTypes: trainingTypesArraySchema,
  _clientUpdatedAt: z.string().max(50),
});

// ── Zod Schemas ─────────────────────────────────────────────────────────────

const trainingRecordSchema = z.object({
  completed:       dateSchema,
  expiry:          dateSchema.optional(),
  trainer:         z.string().max(200).nullable().optional(),
  method:          z.enum(['classroom', 'e-learning', 'practical', 'online']).nullable().optional(),
  certificate_ref: z.string().max(200).nullable().optional(),
  evidence_ref:    z.string().max(200).nullable().optional(),
  level:           z.string().max(50).nullable().optional(),
  notes:           z.string().max(5000).nullable().optional(),
  _clientUpdatedAt: z.string().max(50).optional(),
});

const supervisionBaseSchema = z.object({
  staffId:    staffIdSchema,
  date:       dateSchema,
  supervisor: z.string().max(200).nullable().optional(),
  topics:     z.string().max(5000).nullable().optional(),
  actions:    z.string().max(5000).nullable().optional(),
  next_due:   dateSchema.optional(),
  notes:      z.string().max(5000).nullable().optional(),
  _clientUpdatedAt: z.string().max(50).optional(),
});

const supervisionCreateSchema = supervisionBaseSchema;
const supervisionUpdateSchema = supervisionBaseSchema.extend({
  _clientUpdatedAt: z.string().max(50),
});

const appraisalBaseSchema = z.object({
  staffId:          staffIdSchema,
  date:             dateSchema,
  appraiser:        z.string().max(200).nullable().optional(),
  objectives:       z.string().max(5000).nullable().optional(),
  training_needs:   z.string().max(5000).nullable().optional(),
  development_plan: z.string().max(5000).nullable().optional(),
  next_due:         dateSchema.optional(),
  notes:            z.string().max(5000).nullable().optional(),
  _clientUpdatedAt: z.string().max(50).optional(),
});

const appraisalCreateSchema = appraisalBaseSchema;
const appraisalUpdateSchema = appraisalBaseSchema.extend({
  _clientUpdatedAt: z.string().max(50),
});

const fireDrillBaseSchema = z.object({
  date:                    dateSchema,
  time:                    z.string().max(10).nullable().optional(),
  scenario:                z.string().max(2000).nullable().optional(),
  evacuation_time_seconds: z.coerce.number().int().min(0).max(3600).nullable().optional(),
  staff_present:           z.array(z.string().max(20)).max(200).optional(),
  residents_evacuated:     z.coerce.number().int().min(0).max(500).nullable().optional(),
  issues:                  z.string().max(5000).nullable().optional(),
  corrective_actions:      z.string().max(5000).nullable().optional(),
  conducted_by:            z.string().max(200).nullable().optional(),
  notes:                   z.string().max(5000).nullable().optional(),
  _clientUpdatedAt:        z.string().max(50).optional(),
});

const fireDrillCreateSchema = fireDrillBaseSchema;
const fireDrillUpdateSchema = fireDrillBaseSchema.extend({
  _clientUpdatedAt: z.string().max(50),
});

// GET /api/training?home=X — one-shot load for TrainingMatrix
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const [trainingResult, supervisionsResult, appraisalsResult, fireDrills, staffResult] = await Promise.all([
      trainingRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset }),
      supervisionRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset }),
      appraisalRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset }),
      fireDrillRepo.findByHome(req.home.id),
      staffRepo.findByHome(req.home.id),
    ]);
    const training = trainingResult.rows;
    const supervisions = supervisionsResult.rows;
    const appraisals = appraisalsResult.rows;
    const staff = staffResult.rows.map(s => ({ id: s.id, name: s.name, role: s.role, team: s.team, active: s.active, start_date: s.start_date }));
    const trainingTypes = getTrainingTypes(req.home.config);
    const supervisionConfig = {
      supervision_frequency_probation: req.home.config?.supervision_frequency_probation ?? 30,
      supervision_frequency_standard: req.home.config?.supervision_frequency_standard ?? 49,
      supervision_probation_months: req.home.config?.supervision_probation_months ?? 6,
    };
    res.json({
      training,
      supervisions,
      appraisals,
      fireDrills,
      trainingTypes,
      staff,
      supervisionConfig,
      configUpdatedAt: req.home.updated_at ? req.home.updated_at.toISOString() : null,
    });
  } catch (err) { next(err); }
});

// PUT /api/training/config/types?home=X — update training types in config
router.get('/:staffId/:typeId/files', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const staffParsed = staffIdSchema.safeParse(req.params.staffId);
    const typeParsed = typeIdSchema.safeParse(req.params.typeId);
    if (!staffParsed.success || !typeParsed.success) {
      return res.status(400).json({ error: 'Invalid staffId or typeId' });
    }
    const files = await trainingAttachmentsRepo.findAttachments(req.home.id, staffParsed.data, typeParsed.data);
    res.json(files);
  } catch (err) { next(err); }
});

router.post('/:staffId/:typeId/files', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  const staffParsed = staffIdSchema.safeParse(req.params.staffId);
  const typeParsed = typeIdSchema.safeParse(req.params.typeId);
  if (!staffParsed.success || !typeParsed.success) {
    return res.status(400).json({ error: 'Invalid staffId or typeId' });
  }

  attachmentUpload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 20MB)' });
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filePath = req.file.path;
    try {
      const descriptionParsed = attachmentDescriptionSchema.safeParse(req.body.description || null);
      if (!descriptionParsed.success) {
        await unlink(filePath).catch(() => {});
        return res.status(400).json({ error: descriptionParsed.error.issues[0]?.message || 'Invalid description' });
      }
      const detected = await fileTypeFromFile(filePath);
      if (detected && detected.mime !== req.file.mimetype) {
        await unlink(filePath).catch(() => {});
        return res.status(400).json({ error: 'File content does not match declared type' });
      }
      const attachment = await trainingAttachmentsRepo.create(req.home.id, staffParsed.data, typeParsed.data, {
        original_name: req.file.originalname,
        stored_name: req.file.filename,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        description: descriptionParsed.data || null,
        uploaded_by: req.user.username,
      });
      await auditService.log('training_attachment_upload', req.home.slug, req.user.username, {
        staffId: staffParsed.data,
        typeId: typeParsed.data,
        fileId: attachment.id,
      });
      res.status(201).json(attachment);
    } catch (error) {
      await unlink(filePath).catch(() => {});
      next(error);
    }
  });
});

router.get('/files/:id/download', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid attachment ID' });
    const attachment = await trainingAttachmentsRepo.findById(id, req.home.id);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });
    const uploadDir = path.resolve(config.upload.dir);
    const filePath = path.resolve(path.join(
      config.upload.dir,
      String(req.home.id),
      'training',
      attachment.staff_id,
      attachment.training_type,
      attachment.stored_name,
    ));
    if (!filePath.startsWith(uploadDir)) return res.status(403).json({ error: 'Forbidden' });
    sendStoredDownload(res, next, filePath, {
      originalName: attachment.original_name,
      mimeType: attachment.mime_type,
    });
  } catch (err) { next(err); }
});

router.delete('/files/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid attachment ID' });
    const attachment = await trainingAttachmentsRepo.softDelete(id, req.home.id);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });
    await auditService.log('training_attachment_delete', req.home.slug, req.user.username, {
      staffId: attachment.staff_id,
      typeId: attachment.training_type,
      fileId: id,
    });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

router.put('/config/types', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = trainingTypesUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const updatedAt = await updateTrainingTypesConfig(
      req.home.id,
      parsed.data.trainingTypes,
      null,
      parsed.data._clientUpdatedAt
    );
    if (updatedAt === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    await auditService.log('training_types_update', req.home.slug, req.user.username, { typeCount: parsed.data.trainingTypes.length });
    res.json({ ok: true, updated_at: updatedAt });
  } catch (err) { next(err); }
});

// POST /api/training/supervisions?home=X — create supervision
router.post('/supervisions', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = supervisionCreateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const record = { ...parsed.data, id: `sup-${randomUUID()}` };
    const session = await supervisionRepo.upsertSession(req.home.id, parsed.data.staffId, record);
    await auditService.log('supervision_create', req.home.slug, req.user.username, { staffId: parsed.data.staffId });
    res.status(201).json(session);
  } catch (err) { next(err); }
});

// PUT /api/training/supervisions/:id?home=X — update supervision
router.put('/supervisions/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = supervisionUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const record = { ...parsed.data, id: idParsed.data };
    const session = await supervisionRepo.upsertSession(req.home.id, parsed.data.staffId, record);
    await auditService.log('supervision_update', req.home.slug, req.user.username, { staffId: parsed.data.staffId, id: idParsed.data });
    res.json(session);
  } catch (err) { next(err); }
});

// DELETE /api/training/supervisions/:id?home=X — soft-delete supervision
router.delete('/supervisions/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await supervisionRepo.softDeleteSession(req.home.id, idParsed.data);
    if (!deleted) return res.status(404).json({ error: 'Supervision not found' });
    await auditService.log('supervision_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/training/appraisals?home=X — create appraisal
router.post('/appraisals', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = appraisalCreateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const record = { ...parsed.data, id: `apr-${randomUUID()}` };
    const appraisal = await appraisalRepo.upsertAppraisal(req.home.id, parsed.data.staffId, record);
    await auditService.log('appraisal_create', req.home.slug, req.user.username, { staffId: parsed.data.staffId });
    res.status(201).json(appraisal);
  } catch (err) { next(err); }
});

// PUT /api/training/appraisals/:id?home=X — update appraisal
router.put('/appraisals/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = appraisalUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const record = { ...parsed.data, id: idParsed.data };
    const appraisal = await appraisalRepo.upsertAppraisal(req.home.id, parsed.data.staffId, record);
    await auditService.log('appraisal_update', req.home.slug, req.user.username, { staffId: parsed.data.staffId, id: idParsed.data });
    res.json(appraisal);
  } catch (err) { next(err); }
});

// DELETE /api/training/appraisals/:id?home=X — soft-delete appraisal
router.delete('/appraisals/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await appraisalRepo.softDeleteAppraisal(req.home.id, idParsed.data);
    if (!deleted) return res.status(404).json({ error: 'Appraisal not found' });
    await auditService.log('appraisal_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/training/fire-drills?home=X — create fire drill
router.post('/fire-drills', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = fireDrillCreateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const record = { ...parsed.data, id: `fd-${randomUUID()}` };
    const drill = await fireDrillRepo.upsertDrill(req.home.id, record);
    await auditService.log('fire_drill_create', req.home.slug, req.user.username, { id: record.id });
    res.status(201).json(drill);
  } catch (err) { next(err); }
});

// PUT /api/training/fire-drills/:id?home=X — update fire drill
router.put('/fire-drills/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = fireDrillUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const record = { ...parsed.data, id: idParsed.data };
    const drill = await fireDrillRepo.upsertDrill(req.home.id, record);
    await auditService.log('fire_drill_update', req.home.slug, req.user.username, { id: idParsed.data });
    res.json(drill);
  } catch (err) { next(err); }
});

// DELETE /api/training/fire-drills/:id?home=X — hard-delete fire drill
router.delete('/fire-drills/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await fireDrillRepo.removeDrill(req.home.id, idParsed.data);
    if (!deleted) return res.status(404).json({ error: 'Fire drill not found' });
    await auditService.log('fire_drill_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PUT /api/training/:staffId/:typeId?home=X — upsert single training record
// NOTE: Must be registered AFTER all named routes (config/*, supervisions/*, appraisals/*, fire-drills/*)
// to avoid the greedy /:staffId/:typeId pattern shadowing them.
router.put('/:staffId/:typeId', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const staffParsed = staffIdSchema.safeParse(req.params.staffId);
    const typeParsed = typeIdSchema.safeParse(req.params.typeId);
    if (!staffParsed.success || !typeParsed.success) return res.status(400).json({ error: 'Invalid staffId or typeId' });
    const parsed = trainingRecordSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const record = await trainingRepo.upsertRecord(req.home.id, staffParsed.data, typeParsed.data, parsed.data);
    await auditService.log('training_record_upsert', req.home.slug, req.user.username, { staffId: staffParsed.data, typeId: typeParsed.data });
    res.json(record);
  } catch (err) { next(err); }
});

// DELETE /api/training/:staffId/:typeId?home=X — remove training record
// NOTE: Must be registered AFTER all named routes for the same reason.
router.delete('/:staffId/:typeId', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const staffParsed = staffIdSchema.safeParse(req.params.staffId);
    const typeParsed = typeIdSchema.safeParse(req.params.typeId);
    if (!staffParsed.success || !typeParsed.success) return res.status(400).json({ error: 'Invalid staffId or typeId' });
    await trainingRepo.removeRecord(req.home.id, staffParsed.data, typeParsed.data);
    await auditService.log('training_record_delete', req.home.slug, req.user.username, { staffId: staffParsed.data, typeId: typeParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
