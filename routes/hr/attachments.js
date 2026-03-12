import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { createReadStream, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { fileTypeFromFile } from 'file-type';
import { requireAuth, requireHomeAccess, requireModule } from '../../middleware/auth.js';
import { config } from '../../config.js';
import * as hrRepo from '../../repositories/hrRepo.js';
import * as auditService from '../../services/auditService.js';
import { caseTypeSchema } from './schemas.js';

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
    const ext = path.extname(file.originalname);
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

// GET /api/hr/attachments/:caseType/:caseId?home=X
router.get('/attachments/:caseType/:caseId', requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    const parsed = caseTypeSchema.safeParse(req.params.caseType);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid case type' });
    const caseId = Number(req.params.caseId);
    if (!Number.isInteger(caseId) || caseId < 1) return res.status(400).json({ error: 'Invalid case ID' });
    const files = await hrRepo.findAttachments(parsed.data, caseId, req.home.id);
    res.json(files);
  } catch (err) { next(err); }
});

// POST /api/hr/attachments/:caseType/:caseId?home=X
router.post('/attachments/:caseType/:caseId', requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    // Validate caseType BEFORE multer writes any bytes to disk
    const caseTypeParsed = caseTypeSchema.safeParse(req.params.caseType);
    if (!caseTypeParsed.success) return res.status(400).json({ error: 'Invalid case type' });
    const caseId = Number(req.params.caseId);
    if (!Number.isInteger(caseId) || caseId < 1) return res.status(400).json({ error: 'Invalid case ID' });
    req._homeId = req.home.id;
    upload.single('file')(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 20MB)' });
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      try {
        // Verify file magic bytes match declared MIME type
        const filePath = req.file.path;
        const detected = await fileTypeFromFile(filePath);
        if (detected && detected.mime !== req.file.mimetype) {
          await unlink(filePath).catch(() => {});
          return res.status(400).json({ error: 'File content does not match declared type' });
        }
        const descParsed = z.string().max(500).optional().safeParse(req.body.description);
        const description = descParsed.success ? (descParsed.data || null) : null;
        const attachment = await hrRepo.createAttachment(req.home.id, caseTypeParsed.data, caseId, {
          original_name: req.file.originalname,
          stored_name: req.file.filename,
          mime_type: req.file.mimetype,
          size_bytes: req.file.size,
          description: description,
          uploaded_by: req.user.username,
        });
        await auditService.log('hr_attachment_upload', req.home.slug, req.user.username, { id: attachment.id });
        res.status(201).json(attachment);
      } catch (e) { next(e); }
    });
  } catch (err) { next(err); }
});

// GET /api/hr/attachments/download/:id?home=X
router.get('/attachments/download/:id', requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid attachment ID' });
    const att = await hrRepo.findAttachmentById(id, req.home.id);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    const uploadDir = path.resolve(config.upload.dir);
    const filePath = path.resolve(path.join(config.upload.dir, String(req.home.id), att.case_type, String(att.case_id), att.stored_name));
    if (!filePath.startsWith(uploadDir)) return res.status(403).json({ error: 'Forbidden' });
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
  } catch (err) { next(err); }
});

// DELETE /api/hr/attachments/:id?home=X
router.delete('/attachments/:id', requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid attachment ID' });
    const att = await hrRepo.deleteAttachment(id, req.home.id);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    // Delete file from disk (best effort)
    const filePath = path.join(config.upload.dir, String(req.home.id), att.case_type, String(att.case_id), att.stored_name);
    await unlink(filePath).catch(() => {});
    await auditService.log('hr_attachment_delete', req.home.slug, req.user.username, { id, caseType: att.case_type, caseId: att.case_id });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

export default router;
