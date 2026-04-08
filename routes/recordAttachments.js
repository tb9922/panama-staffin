import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { createReadStream, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { fileTypeFromFile } from 'file-type';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { config } from '../config.js';
import * as recordAttachmentsRepo from '../repositories/recordAttachments.js';
import * as auditService from '../services/auditService.js';

const router = Router();

const moduleSchema = z.enum([
  'incident',
  'complaint',
  'ipc_audit',
  'maintenance',
  'bed',
  'budget_month',
  'handover_entry',
  'payroll_run',
  'schedule_override',
  'investigation_meeting',
  'supervision',
  'appraisal',
  'fire_drill',
  'policy_review',
  'risk',
  'whistleblowing',
  'dols',
  'mca_assessment',
  'dpia',
  'ropa',
  'finance_expense',
  'finance_resident',
  'finance_invoice',
  'finance_payment_schedule',
  'payroll_rate_rule',
  'payroll_timesheet',
  'payroll_tax_code',
  'payroll_pension',
  'payroll_sick_period',
  'agency_provider',
  'agency_shift',
  'care_certificate',
  'staff_register',
]);
const recordIdSchema = z.string().min(1).max(50);
const permissionByModule = {
  incident: 'compliance',
  complaint: 'compliance',
  ipc_audit: 'compliance',
  maintenance: 'governance',
  bed: 'finance',
  budget_month: 'finance',
  handover_entry: 'scheduling',
  payroll_run: 'payroll',
  schedule_override: 'scheduling',
  investigation_meeting: 'hr',
  supervision: 'compliance',
  appraisal: 'compliance',
  fire_drill: 'compliance',
  policy_review: 'governance',
  risk: 'governance',
  whistleblowing: 'governance',
  dols: 'compliance',
  mca_assessment: 'compliance',
  dpia: 'gdpr',
  ropa: 'gdpr',
  finance_expense: 'finance',
  finance_resident: 'finance',
  finance_invoice: 'finance',
  finance_payment_schedule: 'finance',
  payroll_rate_rule: 'payroll',
  payroll_timesheet: 'payroll',
  payroll_tax_code: 'payroll',
  payroll_pension: 'payroll',
  payroll_sick_period: 'payroll',
  agency_provider: 'payroll',
  agency_shift: 'payroll',
  care_certificate: 'compliance',
  staff_register: 'staff',
};

function safePath(segment) {
  return String(segment).replace(/[^a-zA-Z0-9_-]/g, '');
}

function requireRecordModule(level) {
  return (req, res, next) => {
    const parsed = moduleSchema.safeParse(req.params.module);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid attachment module' });
    req.recordAttachmentModule = parsed.data;
    return requireModule(permissionByModule[parsed.data], level)(req, res, next);
  };
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
    req.params.module = attachment.module;
    const moduleAccess = requireRecordModule('read');
    moduleAccess(req, res, async () => {
      const uploadDir = path.resolve(config.upload.dir);
      const filePath = path.resolve(path.join(
        config.upload.dir,
        String(req.home.id),
        attachment.module,
        attachment.record_id,
        attachment.stored_name,
      ));
      if (!filePath.startsWith(uploadDir)) return res.status(403).json({ error: 'Forbidden' });
      const safeName = attachment.original_name.replace(/["\r\n;]/g, '_');
      res.set({
        'Content-Type': attachment.mime_type,
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Content-Length': attachment.size_bytes,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'X-Frame-Options': 'DENY',
      });
      createReadStream(filePath).pipe(res);
    });
  } catch (err) { next(err); }
});

router.get('/:module/:recordId', readRateLimiter, requireAuth, requireHomeAccess, requireRecordModule('read'), async (req, res, next) => {
  try {
    const moduleParsed = moduleSchema.safeParse(req.params.module);
    const recordParsed = recordIdSchema.safeParse(req.params.recordId);
    if (!moduleParsed.success || !recordParsed.success) {
      return res.status(400).json({ error: 'Invalid attachment target' });
    }
    const files = await recordAttachmentsRepo.findAttachments(req.home.id, moduleParsed.data, recordParsed.data);
    res.json(files);
  } catch (err) { next(err); }
});

router.post('/:module/:recordId', writeRateLimiter, requireAuth, requireHomeAccess, requireRecordModule('write'), async (req, res, next) => {
  const moduleParsed = moduleSchema.safeParse(req.params.module);
  const recordParsed = recordIdSchema.safeParse(req.params.recordId);
  if (!moduleParsed.success || !recordParsed.success) {
    return res.status(400).json({ error: 'Invalid attachment target' });
  }

  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 20MB)' });
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filePath = req.file.path;
    try {
      const detected = await fileTypeFromFile(filePath);
      if (detected && detected.mime !== req.file.mimetype) {
        await unlink(filePath).catch(() => {});
        return res.status(400).json({ error: 'File content does not match declared type' });
      }
      const attachment = await recordAttachmentsRepo.create(req.home.id, moduleParsed.data, recordParsed.data, {
        original_name: req.file.originalname,
        stored_name: req.file.filename,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        description: req.body.description || null,
        uploaded_by: req.user.username,
      });
      await auditService.log('record_attachment_upload', req.home.slug, req.user.username, {
        module: moduleParsed.data,
        recordId: recordParsed.data,
        fileId: attachment.id,
      });
      res.status(201).json(attachment);
    } catch (e) {
      await unlink(filePath).catch(() => {});
      next(e);
    }
  });
});

router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid attachment ID' });
    const attachment = await recordAttachmentsRepo.findById(id, req.home.id);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });
    req.params.module = attachment.module;
    const moduleAccess = requireRecordModule('write');
    moduleAccess(req, res, async () => {
      const deleted = await recordAttachmentsRepo.softDelete(id, req.home.id);
      if (!deleted) return res.status(404).json({ error: 'Attachment not found' });
      await auditService.log('record_attachment_delete', req.home.slug, req.user.username, {
        module: attachment.module,
        recordId: attachment.record_id,
        fileId: id,
      });
      res.json({ deleted: true });
    });
  } catch (err) { next(err); }
});

export default router;
