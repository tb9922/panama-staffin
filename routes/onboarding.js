import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { fileTypeFromFile } from 'file-type';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { diffFields } from '../lib/audit.js';
import { config } from '../config.js';
import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as onboardingAttachmentsRepo from '../repositories/onboardingAttachments.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as auditService from '../services/auditService.js';
import { nullableDateInput } from '../lib/zodHelpers.js';

const router = Router();
const staffIdSchema = z.string().min(1).max(20);
const sectionSchema = z.enum([
  'dbs_check', 'right_to_work', 'references', 'identity_check', 'health_declaration',
  'qualifications', 'contract', 'employment_history', 'day1_induction', 'policy_acknowledgement',
]);
const dateSchema = nullableDateInput;

function safePath(segment) {
  return String(segment).replace(/[^a-zA-Z0-9_-]/g, '');
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const staffId = safePath(req.params.staffId);
    const section = safePath(req.params.section);
    if (!staffId || !section) return cb(new Error('Invalid path'));
    const dir = path.join(config.upload.dir, String(req.home.id), 'onboarding', staffId, section);
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

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.upload.maxFileSize },
});

// Onboarding section data — strict schema, only known fields accepted
const onboardingSectionSchema = z.object({
  status:         z.enum(['not_started', 'in_progress', 'completed', 'na']).optional(),
  date:           dateSchema.optional(),
  expiry:         dateSchema.optional(),
  reference:      z.string().max(200).nullable().optional(),
  notes:          z.string().max(5000).nullable().optional(),
  verified_by:    z.string().max(200).nullable().optional(),
  verified_date:  dateSchema.optional(),
}).passthrough().refine(
  (value) => JSON.stringify(value).length <= 50000,
  'Onboarding section payload is too large'
);

// GET /api/onboarding?home=X
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const [onboarding, staffResult] = await Promise.all([
      onboardingRepo.findByHome(req.home.id),
      staffRepo.findByHome(req.home.id),
    ]);
    const staff = staffResult.rows.map(s => ({ id: s.id, name: s.name, role: s.role, team: s.team, active: s.active, start_date: s.start_date }));
    res.json({ onboarding, staff });
  } catch (err) { next(err); }
});

// PUT /api/onboarding/:staffId/:section?home=X — upsert section data
router.put('/:staffId/:section', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const staffIdParsed = staffIdSchema.safeParse(req.params.staffId);
    const sectionParsed = sectionSchema.safeParse(req.params.section);
    if (!staffIdParsed.success || !sectionParsed.success) {
      return res.status(400).json({ error: 'Invalid staffId or section' });
    }
    const bodyParsed = onboardingSectionSchema.safeParse(req.body);
    if (!bodyParsed.success) return zodError(res, bodyParsed);
    const allOnboarding = await onboardingRepo.findByHome(req.home.id);
    const beforeSection = allOnboarding[staffIdParsed.data]?.[sectionParsed.data] ?? null;
    const result = await onboardingRepo.upsertSection(req.home.id, staffIdParsed.data, sectionParsed.data, bodyParsed.data, req.user.username);
    const changes = diffFields(beforeSection, bodyParsed.data);
    await auditService.log('onboarding_update', req.home.slug, req.user.username, { staffId: staffIdParsed.data, section: sectionParsed.data, changes });
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/onboarding/:staffId/:section?home=X — clear section data
router.delete('/:staffId/:section', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const staffIdParsed = staffIdSchema.safeParse(req.params.staffId);
    const sectionParsed = sectionSchema.safeParse(req.params.section);
    if (!staffIdParsed.success || !sectionParsed.success) {
      return res.status(400).json({ error: 'Invalid staffId or section' });
    }
    await onboardingRepo.clearSection(req.home.id, staffIdParsed.data, sectionParsed.data, req.user.username);
    await auditService.log('onboarding_clear', req.home.slug, req.user.username, { staffId: staffIdParsed.data, section: sectionParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/:staffId/:section/history', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const staffIdParsed = staffIdSchema.safeParse(req.params.staffId);
    const sectionParsed = sectionSchema.safeParse(req.params.section);
    if (!staffIdParsed.success || !sectionParsed.success) {
      return res.status(400).json({ error: 'Invalid staffId or section' });
    }
    const history = await onboardingRepo.getHistory(req.home.id, staffIdParsed.data, sectionParsed.data);
    res.json(history);
  } catch (err) { next(err); }
});

router.get('/:staffId/:section/files', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const staffIdParsed = staffIdSchema.safeParse(req.params.staffId);
    const sectionParsed = sectionSchema.safeParse(req.params.section);
    if (!staffIdParsed.success || !sectionParsed.success) {
      return res.status(400).json({ error: 'Invalid staffId or section' });
    }
    const files = await onboardingAttachmentsRepo.findAttachments(req.home.id, staffIdParsed.data, sectionParsed.data);
    res.json(files);
  } catch (err) { next(err); }
});

router.post('/:staffId/:section/files', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  const staffIdParsed = staffIdSchema.safeParse(req.params.staffId);
  const sectionParsed = sectionSchema.safeParse(req.params.section);
  if (!staffIdParsed.success || !sectionParsed.success) {
    return res.status(400).json({ error: 'Invalid staffId or section' });
  }

  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 20MB)' });
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const filePath = req.file.path;
    try {
      const detected = await fileTypeFromFile(filePath);
      if (detected && detected.mime !== req.file.mimetype) {
        await unlink(filePath).catch(() => {});
        return res.status(400).json({ error: 'File content does not match declared type' });
      }

      const attachment = await onboardingAttachmentsRepo.create(req.home.id, staffIdParsed.data, sectionParsed.data, {
        original_name: req.file.originalname,
        stored_name: req.file.filename,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        description: req.body.description || null,
        uploaded_by: req.user.username,
      });

      await auditService.log('onboarding_file_upload', req.home.slug, req.user.username, {
        staffId: staffIdParsed.data,
        section: sectionParsed.data,
        fileId: attachment.id,
      });
      res.status(201).json(attachment);
    } catch (e) {
      await unlink(filePath).catch(() => {});
      next(e);
    }
  });
});

router.get('/files/:id/download', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });
    const attachment = await onboardingAttachmentsRepo.findById(id, req.home.id);
    if (!attachment) return res.status(404).json({ error: 'File not found' });

    const uploadDir = path.resolve(config.upload.dir);
    const filePath = path.resolve(path.join(
      config.upload.dir,
      String(req.home.id),
      'onboarding',
      attachment.staff_id,
      attachment.section,
      attachment.stored_name,
    ));
    if (!filePath.startsWith(uploadDir)) return res.status(403).json({ error: 'Forbidden' });

    const safeName = attachment.original_name.replace(/["\r\n]/g, '_');
    res.set({
      'Content-Type': attachment.mime_type,
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Content-Length': attachment.size_bytes,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'X-Frame-Options': 'DENY',
    });
    res.sendFile(filePath);
  } catch (err) { next(err); }
});

router.delete('/files/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await onboardingAttachmentsRepo.softDelete(id, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'File not found' });
    await auditService.log('onboarding_file_delete', req.home.slug, req.user.username, { fileId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
