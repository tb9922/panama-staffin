import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { fileTypeFromFile } from 'file-type';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { sendStoredDownload } from '../lib/sendDownload.js';
import { assertFilePassedMalwareScan } from '../lib/malwareScan.js';
import { config } from '../config.js';
import { isPathInsideRoot } from '../lib/pathSafety.js';
import * as recordAttachmentsRepo from '../repositories/recordAttachments.js';
import * as auditService from '../services/auditService.js';
import {
  RECORD_ATTACHMENT_MODULE_IDS,
  RECORD_ATTACHMENT_PERMISSION_BY_MODULE,
} from '../shared/recordAttachmentModules.js';

const router = Router();

const moduleSchema = z.enum(RECORD_ATTACHMENT_MODULE_IDS);
const recordIdSchema = z.string().min(1).max(50);
const descriptionSchema = z.string().max(5000).nullable().optional();

function safePath(segment) {
  return String(segment).replace(/[^a-zA-Z0-9_-]/g, '');
}

function withRecordModuleAccess(req, res, next, moduleId, level, handler) {
  return requireModule(RECORD_ATTACHMENT_PERMISSION_BY_MODULE[moduleId], level)(req, res, () => {
    Promise.resolve(handler()).catch(next);
  });
}

function parseModuleAndRecord(req, res) {
  const moduleParsed = moduleSchema.safeParse(req.params.module);
  const recordParsed = recordIdSchema.safeParse(req.params.recordId);
  if (!moduleParsed.success || !recordParsed.success) {
    res.status(400).json({ error: 'Invalid attachment target' });
    return null;
  }
  return { moduleId: moduleParsed.data, recordId: recordParsed.data };
}

async function requireExistingParent(req, res, moduleId, recordId) {
  const exists = await recordAttachmentsRepo.parentExists(req.home.id, moduleId, recordId);
  if (!exists) {
    res.status(404).json({ error: 'Attachment parent record not found' });
    return false;
  }
  return true;
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const moduleId = safePath(req.params.module);
    const recordId = safePath(req.params.recordId);
    if (!moduleId || !recordId) return cb(new Error('Invalid path parameters'));
    const dir = path.join(config.upload.dir, String(req.home.id), moduleId, recordId);
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

router.get('/download/:id', readRateLimiter, requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid attachment ID' });
    const attachment = await recordAttachmentsRepo.findById(id, req.home.id);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });
    await withRecordModuleAccess(req, res, next, attachment.module, 'read', async () => {
      const uploadDir = path.resolve(config.upload.dir);
      const filePath = path.resolve(path.join(
        config.upload.dir,
        String(req.home.id),
        attachment.module,
        attachment.record_id,
        attachment.stored_name
      ));
      if (!isPathInsideRoot(uploadDir, filePath)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      sendStoredDownload(res, next, filePath, {
        originalName: attachment.original_name,
        mimeType: attachment.mime_type,
      });
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:module/:recordId', readRateLimiter, requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = parseModuleAndRecord(req, res);
    if (!parsed) return;
    await withRecordModuleAccess(req, res, next, parsed.moduleId, 'read', async () => {
      if (!await requireExistingParent(req, res, parsed.moduleId, parsed.recordId)) return;
      const files = await recordAttachmentsRepo.findAttachments(req.home.id, parsed.moduleId, parsed.recordId);
      res.json(files);
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:module/:recordId', writeRateLimiter, requireAuth, requireHomeAccess, async (req, res, next) => {
  const parsed = parseModuleAndRecord(req, res);
  if (!parsed) return;
  await withRecordModuleAccess(req, res, next, parsed.moduleId, 'write', async () => {
    if (!await requireExistingParent(req, res, parsed.moduleId, parsed.recordId)) return;
    upload.single('file')(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 20MB)' });
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const filePath = req.file.path;
      try {
        const descriptionParsed = descriptionSchema.safeParse(req.body.description || null);
        if (!descriptionParsed.success) {
          await unlink(filePath).catch(() => {});
          return res.status(400).json({ error: descriptionParsed.error.issues[0]?.message || 'Invalid description' });
        }
        const detected = await fileTypeFromFile(filePath);
        if (detected && detected.mime !== req.file.mimetype) {
          await unlink(filePath).catch(() => {});
          return res.status(400).json({ error: 'File content does not match declared type' });
        }
        await assertFilePassedMalwareScan(filePath);
        const attachment = await recordAttachmentsRepo.create(req.home.id, parsed.moduleId, parsed.recordId, {
          original_name: req.file.originalname,
          stored_name: req.file.filename,
          mime_type: req.file.mimetype,
          size_bytes: req.file.size,
          description: descriptionParsed.data || null,
          uploaded_by: req.user.username,
        });
        await auditService.log('record_attachment_upload', req.home.slug, req.user.username, {
          module: parsed.moduleId,
          recordId: parsed.recordId,
          fileId: attachment.id,
        });
        res.status(201).json(attachment);
      } catch (e) {
        await unlink(filePath).catch(() => {});
        next(e);
      }
    });
  });
});

router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid attachment ID' });
    const attachment = await recordAttachmentsRepo.findById(id, req.home.id);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });
    await withRecordModuleAccess(req, res, next, attachment.module, 'write', async () => {
      const deleted = await recordAttachmentsRepo.softDelete(id, req.home.id);
      if (!deleted) return res.status(404).json({ error: 'Attachment not found' });
      await auditService.log('record_attachment_delete', req.home.slug, req.user.username, {
        module: attachment.module,
        recordId: attachment.record_id,
        fileId: id,
      });
      res.json({ deleted: true });
    });
  } catch (err) {
    next(err);
  }
});

export default router;
