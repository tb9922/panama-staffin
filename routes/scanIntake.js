import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { fileTypeFromFile } from 'file-type';
import { requireAuth, requireHomeAccess } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { config } from '../config.js';
import { hasModuleAccess } from '../shared/roles.js';
import { SCAN_INTAKE_ACCESS_MODULES, SCAN_INTAKE_TARGET_IDS, getScanTarget } from '../shared/scanIntake.js';
import { SCAN_INTAKE_UPLOAD_POLICY } from '../shared/uploadPolicies.js';
import { validateDeclaredUploadType, validateDetectedUploadType } from '../lib/uploadValidation.js';
import { RECORD_ATTACHMENT_MODULE_IDS, RECORD_ATTACHMENT_PERMISSION_BY_MODULE } from '../shared/recordAttachmentModules.js';
import * as documentIntakeRepo from '../repositories/documentIntakeRepo.js';
import * as scanIntakeService from '../services/scanIntakeService.js';
import * as auditService from '../services/auditService.js';
import { caseTypeSchema } from './hr/schemas.js';

const router = Router();

const idSchema = z.coerce.number().int().positive();
const listQuerySchema = z.object({
  status: z.string().optional(),
  target: z.enum(SCAN_INTAKE_TARGET_IDS).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const financeExpenseCreateSchema = z.object({
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().min(1).max(50),
  description: z.string().min(1).max(500),
  supplier: z.string().max(200).nullable().optional(),
  supplier_id: z.preprocess((value) => value === '' ? null : value, z.string().uuid().nullable().optional()),
  invoice_ref: z.string().max(100).nullable().optional(),
  net_amount: z.coerce.number().min(0),
  vat_amount: z.coerce.number().min(0).optional(),
  gross_amount: z.coerce.number().min(0),
  subcategory: z.string().max(100).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

const maintenanceCreateSchema = z.object({
  category: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  frequency: z.string().max(100).nullable().optional(),
  last_completed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  next_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  completed_by: z.string().max(200).nullable().optional(),
  contractor: z.string().max(200).nullable().optional(),
  certificate_ref: z.string().max(200).nullable().optional(),
  certificate_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

const recordAttachmentConfirmSchema = z.object({
  module: z.enum(RECORD_ATTACHMENT_MODULE_IDS),
  record_id: z.string().min(1).max(50),
  description: z.string().max(500).nullable().optional(),
});

const confirmBodySchema = z.object({
  target: z.enum(SCAN_INTAKE_TARGET_IDS),
  description: z.string().max(500).nullable().optional(),
  record_attachment: recordAttachmentConfirmSchema.optional(),
  maintenance: z.object({
    target_type: z.enum(['existing', 'create_check']).default('existing'),
    record_id: z.coerce.number().int().positive().optional(),
    create_check: maintenanceCreateSchema.optional(),
    description: z.string().max(500).nullable().optional(),
  }).optional(),
  finance_ap: z.object({
    target_type: z.enum(['expense', 'payment_schedule', 'create_expense']),
    record_id: z.coerce.number().int().positive().optional(),
    description: z.string().max(500).nullable().optional(),
    expense: financeExpenseCreateSchema.optional(),
  }).optional(),
  hr_attachment: z.object({
    case_type: caseTypeSchema,
    case_id: z.coerce.number().int().positive(),
    description: z.string().max(500).nullable().optional(),
  }).optional(),
  onboarding: z.object({
    staff_id: z.string().min(1).max(20),
    section: z.enum([
      'dbs_check', 'right_to_work', 'references', 'identity_check', 'health_declaration',
      'qualifications', 'contract', 'employment_history', 'day1_induction', 'policy_acknowledgement',
    ]),
    description: z.string().max(500).nullable().optional(),
  }).optional(),
  training: z.object({
    staff_id: z.string().min(1).max(20),
    type_id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
    description: z.string().max(500).nullable().optional(),
  }).optional(),
  cqc: z.object({
    evidence_id: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    create_evidence: z.object({
      quality_statement: z.string().regex(/^(S[1-8]|E[1-6]|C[1-5]|R[1-7]|WL[1-8])$/),
      type: z.enum(['quantitative', 'qualitative']),
      title: z.string().min(1).max(500),
      description: z.string().max(10000).nullable().optional(),
      date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      evidence_category: z.string().max(50).nullable().optional(),
      evidence_owner: z.string().max(200).nullable().optional(),
      review_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    }).optional(),
  }).optional(),
  handover: z.object({
    entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    shift: z.enum(['E', 'L', 'EL', 'N']),
    category: z.enum(['clinical', 'safety', 'operational', 'admin']),
    priority: z.enum(['urgent', 'action', 'info']),
    content: z.string().min(1).max(2000),
    incident_id: z.string().max(50).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
  }).optional(),
});

function safePath(segment) {
  return String(segment || '').replace(/[^a-zA-Z0-9._-]/g, '');
}

function isScanEnabled(req) {
  return Boolean(req.home?.config?.scan_intake_enabled);
}

function getConfiguredTargets(req) {
  const targets = req.home?.config?.scan_intake_targets;
  return Array.isArray(targets) && targets.length
    ? targets.filter((target) => SCAN_INTAKE_TARGET_IDS.includes(target))
    : SCAN_INTAKE_TARGET_IDS;
}

function requireScanInboxAccess(level = 'read') {
  return (req, res, next) => {
    if (req.user?.is_platform_admin && req.homeRole != null) return next();
    const allowed = SCAN_INTAKE_ACCESS_MODULES.some((moduleId) =>
      hasModuleAccess(req.homeRole, moduleId, level)
    );
    if (!allowed) return res.status(403).json({ error: 'Scan inbox access denied' });
    next();
  };
}

function requireTargetWriteAccess(req, res, target, payload) {
  if (target === 'record_attachment') {
    const moduleId = payload?.record_attachment?.module;
    if (!moduleId || !RECORD_ATTACHMENT_MODULE_IDS.includes(moduleId)) {
      res.status(400).json({ error: 'Record attachment target needs a valid module' });
      return false;
    }
    if (!getConfiguredTargets(req).includes(target)) {
      res.status(403).json({ error: 'That destination is disabled for this home' });
      return false;
    }
    if (req.user?.is_platform_admin && req.homeRole != null) return true;
    const permissionModule = RECORD_ATTACHMENT_PERMISSION_BY_MODULE[moduleId];
    if (!permissionModule || !hasModuleAccess(req.homeRole, permissionModule, 'write')) {
      res.status(403).json({ error: `Insufficient permissions for ${permissionModule || 'record attachments'}` });
      return false;
    }
    return true;
  }
  const targetDef = getScanTarget(target);
  if (!targetDef) {
    res.status(400).json({ error: 'Unsupported scan target' });
    return false;
  }
  if (!getConfiguredTargets(req).includes(target)) {
    res.status(403).json({ error: 'That destination is disabled for this home' });
    return false;
  }
  if (req.user?.is_platform_admin && req.homeRole != null) return true;
  if (!hasModuleAccess(req.homeRole, targetDef.permissionModule, 'write')) {
    res.status(403).json({ error: `Insufficient permissions for ${targetDef.permissionModule}` });
    return false;
  }
  return true;
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(config.upload.dir, String(req.home.id), 'scan_intake');
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(safePath(file.originalname)).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const declared = validateDeclaredUploadType({
    originalName: file.originalname,
    mimeType: file.mimetype,
    policy: SCAN_INTAKE_UPLOAD_POLICY,
  });
  if (!declared.ok) return cb(new Error(declared.error));
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: SCAN_INTAKE_UPLOAD_POLICY.maxBytes },
});

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireScanInboxAccess('read'), async (req, res, next) => {
  try {
    if (!isScanEnabled(req)) return res.status(403).json({ error: 'Scan intake is disabled for this home' });
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query' });
    const statuses = parsed.data.status
      ? parsed.data.status.split(',').map((value) => value.trim()).filter(Boolean)
      : undefined;
    const result = await documentIntakeRepo.listByHome(req.home.id, {
      statuses,
      target: parsed.data.target,
      limit: parsed.data.limit || 50,
      offset: parsed.data.offset || 0,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', readRateLimiter, requireAuth, requireHomeAccess, requireScanInboxAccess('read'), async (req, res, next) => {
  try {
    if (!isScanEnabled(req)) return res.status(403).json({ error: 'Scan intake is disabled for this home' });
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid scan item ID' });
    const item = await documentIntakeRepo.findById(idParsed.data, req.home.id);
    if (!item) return res.status(404).json({ error: 'Scan item not found' });
    res.json({ ...item, extraction: scanIntakeService.decryptExtraction(item) });
  } catch (err) {
    next(err);
  }
});

router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireScanInboxAccess('write'), async (req, res, next) => {
  if (!isScanEnabled(req)) return res.status(403).json({ error: 'Scan intake is disabled for this home' });
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 10MB)' });
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const declared = validateDeclaredUploadType({
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        policy: SCAN_INTAKE_UPLOAD_POLICY,
      });
      if (!declared.ok) {
        await unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: declared.error });
      }
      const detected = await fileTypeFromFile(req.file.path);
      const verified = validateDetectedUploadType({
        fileType: declared.fileType,
        detected,
        declaredMimeType: req.file.mimetype,
      });
      if (!verified.ok) {
        await unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: verified.error });
      }

      const item = await scanIntakeService.createScanIntake(req.home.id, {
        file: req.file,
        createdBy: req.user.username,
      });
      await auditService.log('scan_intake_create', req.home.slug, req.user.username, {
        intakeId: item.id,
        status: item.status,
      });
      res.status(201).json({ ...item, extraction: scanIntakeService.decryptExtraction(item) });
    } catch (uploadErr) {
      next(uploadErr);
    }
  });
});

router.post('/:id/confirm', writeRateLimiter, requireAuth, requireHomeAccess, requireScanInboxAccess('write'), async (req, res, next) => {
  try {
    if (!isScanEnabled(req)) return res.status(403).json({ error: 'Scan intake is disabled for this home' });
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid scan item ID' });
    const parsed = confirmBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid confirm payload' });
    if (parsed.data.target === 'record_attachment' && !parsed.data.record_attachment) {
      return res.status(400).json({ error: 'Record attachment confirm data is required' });
    }
    if (parsed.data.target === 'maintenance') {
      const maintenanceBody = parsed.data.maintenance;
      if (!maintenanceBody) return res.status(400).json({ error: 'Maintenance confirm data is required' });
      if (maintenanceBody.target_type === 'existing' && !maintenanceBody.record_id) {
        return res.status(400).json({ error: 'Select a maintenance check or create a new one' });
      }
      if (maintenanceBody.target_type === 'create_check' && !maintenanceBody.create_check) {
        return res.status(400).json({ error: 'New maintenance check details are required' });
      }
    }
    if (parsed.data.target === 'finance_ap' && !parsed.data.finance_ap) {
      return res.status(400).json({ error: 'Finance confirm data is required' });
    }
    if (parsed.data.target === 'hr_attachment' && !parsed.data.hr_attachment) {
      return res.status(400).json({ error: 'HR attachment confirm data is required' });
    }
    if (parsed.data.target === 'onboarding' && !parsed.data.onboarding) {
      return res.status(400).json({ error: 'Onboarding confirm data is required' });
    }
    if (parsed.data.target === 'training' && !parsed.data.training) {
      return res.status(400).json({ error: 'Training confirm data is required' });
    }
    if (parsed.data.target === 'cqc' && !parsed.data.cqc) {
      return res.status(400).json({ error: 'CQC confirm data is required' });
    }
    if (parsed.data.target === 'handover' && !parsed.data.handover) {
      return res.status(400).json({ error: 'Handover confirm data is required' });
    }
    if (!requireTargetWriteAccess(req, res, parsed.data.target, parsed.data)) return;
    const result = await scanIntakeService.confirmScanIntake(req.home.id, idParsed.data, parsed.data, req.user.username);
    await auditService.log('scan_intake_confirm', req.home.slug, req.user.username, {
      intakeId: idParsed.data,
      target: parsed.data.target,
      routedModule: result.routed_module,
      routedRecordId: result.routed_record_id,
      routedAttachmentId: result.routed_attachment_id,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reject', writeRateLimiter, requireAuth, requireHomeAccess, requireScanInboxAccess('write'), async (req, res, next) => {
  try {
    if (!isScanEnabled(req)) return res.status(403).json({ error: 'Scan intake is disabled for this home' });
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid scan item ID' });
    const item = await documentIntakeRepo.update(idParsed.data, req.home.id, {
      status: 'rejected',
      reviewed_by: req.user.username,
      reviewed_at: new Date().toISOString(),
      error_message: null,
    });
    if (!item) return res.status(404).json({ error: 'Scan item not found' });
    await auditService.log('scan_intake_reject', req.home.slug, req.user.username, { intakeId: idParsed.data });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/retry', writeRateLimiter, requireAuth, requireHomeAccess, requireScanInboxAccess('write'), async (req, res, next) => {
  try {
    if (!isScanEnabled(req)) return res.status(403).json({ error: 'Scan intake is disabled for this home' });
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid scan item ID' });
    const item = await scanIntakeService.retryScanIntake(req.home.id, idParsed.data);
    await auditService.log('scan_intake_retry', req.home.slug, req.user.username, {
      intakeId: idParsed.data,
      status: item.status,
    });
    res.json({ ...item, extraction: scanIntakeService.decryptExtraction(item) });
  } catch (err) {
    next(err);
  }
});

export default router;
