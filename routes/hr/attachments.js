import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { mkdirSync } from 'fs';
import { stat, unlink } from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { requireAuth, requireHomeAccess, requireModule } from '../../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../../lib/rateLimiter.js';
import { config } from '../../config.js';
import { sendStoredDownload } from '../../lib/sendDownload.js';
import { assertGenericAttachmentUploadSafe, genericAttachmentFileFilter } from '../../lib/uploadSecurity.js';
import * as hrRepo from '../../repositories/hrRepo.js';
import * as auditService from '../../services/auditService.js';
import { caseTypeSchema } from './schemas.js';
import { withTransaction } from '../../db.js';

const router = Router();

// ── Multer upload config ────────────────────────────────────────────────────
// Sanitize path segment — strip anything that isn't alphanumeric, hyphen, or underscore
function safePath(segment) {
  return String(segment).replace(/[^a-zA-Z0-9_-]/g, '');
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const caseType = safePath(req.params.caseType);
    const caseId = safePath(req.params.caseId);
    if (!caseType || !caseId) return cb(new Error('Invalid path parameters'));
    const dir = path.join(config.upload.dir, String(req._homeId), caseType, caseId);
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    // Sanitize extension: strip anything that isn't alphanumeric or dot
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, crypto.randomUUID() + ext);
  },
});

const upload = multer({ storage, fileFilter: genericAttachmentFileFilter, limits: { fileSize: config.upload.maxFileSize } });

// GET /api/hr/attachments/download/:id?home=X
router.get('/attachments/download/:id', readRateLimiter, requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid attachment ID' });
    const att = await hrRepo.findAttachmentById(id, req.home.id);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    const storedName = String(att.stored_name || '');
    if (!storedName || path.basename(storedName) !== storedName) return res.status(403).json({ error: 'Forbidden' });
    const caseDir = path.resolve(config.upload.dir, String(req.home.id), safePath(att.case_type), String(att.case_id));
    const filePath = path.resolve(caseDir, storedName);
    const withinCaseDir = filePath.startsWith(`${caseDir}${path.sep}`);
    if (!withinCaseDir) return res.status(403).json({ error: 'Forbidden' });
    try {
      await stat(filePath);
    } catch (err) {
      if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') {
        return res.status(404).json({ error: 'Attachment file is missing' });
      }
      throw err;
    }
    await auditService.log('hr_attachment_download', req.home.slug, req.user.username, {
      id: att.id,
      caseType: att.case_type,
      caseId: att.case_id,
    });
    sendStoredDownload(res, next, filePath, {
      originalName: att.original_name,
      mimeType: att.mime_type,
    });
  } catch (err) { next(err); }
});

// GET /api/hr/attachments/:caseType/:caseId?home=X
router.get('/attachments/:caseType/:caseId', readRateLimiter, requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    const parsed = caseTypeSchema.safeParse(req.params.caseType);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid case type' });
    const caseId = Number(req.params.caseId);
    if (!Number.isInteger(caseId) || caseId < 1) return res.status(400).json({ error: 'Invalid case ID' });
    if (!await hrRepo.caseExists(req.home.id, parsed.data, caseId)) return res.status(404).json({ error: 'HR case not found' });
    const files = await hrRepo.findAttachments(parsed.data, caseId, req.home.id);
    res.json(files);
  } catch (err) { next(err); }
});

// POST /api/hr/attachments/:caseType/:caseId?home=X
router.post('/attachments/:caseType/:caseId', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    // Validate caseType BEFORE multer writes any bytes to disk
    const caseTypeParsed = caseTypeSchema.safeParse(req.params.caseType);
    if (!caseTypeParsed.success) return res.status(400).json({ error: 'Invalid case type' });
    const caseId = Number(req.params.caseId);
    if (!Number.isInteger(caseId) || caseId < 1) return res.status(400).json({ error: 'Invalid case ID' });
    if (!await hrRepo.caseExists(req.home.id, caseTypeParsed.data, caseId)) return res.status(404).json({ error: 'HR case not found' });
    req._homeId = req.home.id;
    upload.single('file')(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 20MB)' });
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      try {
        await assertGenericAttachmentUploadSafe(req.file);
        const descParsed = z.string().max(500).optional().safeParse(req.body.description);
        const description = descParsed.success ? (descParsed.data || null) : null;
        const attachment = await withTransaction(async (client) => {
          const created = await hrRepo.createAttachment(req.home.id, caseTypeParsed.data, caseId, {
            original_name: req.file.originalname,
            stored_name: req.file.filename,
            mime_type: req.file.mimetype,
            size_bytes: req.file.size,
            description: description,
            uploaded_by: req.user.username,
          }, client);
          await auditService.log('hr_attachment_upload', req.home.slug, req.user.username, { id: created.id }, client);
          return created;
        });
        res.status(201).json(attachment);
      } catch (e) {
        await unlink(req.file.path).catch(() => {});
        next(e);
      }
    });
  } catch (err) { next(err); }
});

// DELETE /api/hr/attachments/:id?home=X
router.delete('/attachments/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid attachment ID' });
    const att = await withTransaction(async (client) => {
      const deleted = await hrRepo.deleteAttachment(id, req.home.id, client);
      if (!deleted) return null;
      await auditService.log('hr_attachment_delete', req.home.slug, req.user.username, { id, caseType: deleted.case_type, caseId: deleted.case_id }, client);
      return deleted;
    });
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    // Physical file retained on disk — only removed during GDPR retention purge.
    // Deleting on soft-delete would destroy evidence still referenced in the audit trail.
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

export default router;
