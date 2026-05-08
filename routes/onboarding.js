import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { requireAuth, requireHomeAccess } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { diffFields } from '../lib/audit.js';
import { sendStoredDownload } from '../lib/sendDownload.js';
import { assertGenericAttachmentUploadSafe, genericAttachmentFileFilter } from '../lib/uploadSecurity.js';
import { config } from '../config.js';
import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as onboardingAttachmentsRepo from '../repositories/onboardingAttachments.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as auditService from '../services/auditService.js';
import { nullableDateInput } from '../lib/zodHelpers.js';
import { isPathInsideRoot } from '../lib/pathSafety.js';
import {
  canAccessSensitiveOnboarding as roleCanAccessSensitiveOnboarding,
  isSensitiveOnboardingSection,
} from '../shared/staffPolicy.js';
import { hasModuleAccess } from '../shared/roles.js';

const router = Router();
const staffIdSchema = z.string().min(1).max(20);
const sectionSchema = z.enum([
  'dbs_check', 'right_to_work', 'references', 'identity_check', 'health_declaration',
  'qualifications', 'contract', 'employment_history', 'day1_induction', 'policy_acknowledgement',
]);
const dateSchema = nullableDateInput;

function safePath(segment) {
  return String(segment || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function canAccessSensitiveOnboarding(req) {
  return roleCanAccessSensitiveOnboarding(req.homeRole, {
    isPlatformAdmin: req.user?.is_platform_admin && req.homeRole != null,
  });
}

function canAccessOnboarding(req, level) {
  if (req.user?.is_platform_admin && req.homeRole != null) return true;
  return hasModuleAccess(req.homeRole, 'compliance', level, { includeOwn: false })
    || canAccessSensitiveOnboarding(req);
}

function requireOnboardingAccess(level) {
  return (req, res, next) => {
    if (!canAccessOnboarding(req, level)) {
      return res.status(403).json({ error: 'Onboarding access denied' });
    }
    next();
  };
}

function requireOnboardingSectionAccess(req, res, section) {
  if (isSensitiveOnboardingSection(section) && !canAccessSensitiveOnboarding(req)) {
    return res.status(403).json({ error: 'HR or home management role required for this onboarding evidence' });
  }
  return null;
}

function redactOnboardingForRole(req, onboarding) {
  if (canAccessSensitiveOnboarding(req)) return onboarding;
  const redacted = {};
  for (const [staffId, sections] of Object.entries(onboarding || {})) {
    redacted[staffId] = {};
    for (const [section, value] of Object.entries(sections || {})) {
      if (!isSensitiveOnboardingSection(section)) redacted[staffId][section] = value;
    }
  }
  return redacted;
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const staffId = safePath(req.params.staffId);
    const section = safePath(req.params.section);
    if (!staffId || !section) return cb(new Error('Invalid path parameters'));
    const dir = path.join(config.upload.dir, String(req.home.id), 'onboarding', staffId, section);
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, crypto.randomUUID() + ext);
  },
});

const upload = multer({ storage, fileFilter: genericAttachmentFileFilter, limits: { fileSize: config.upload.maxFileSize } });

// Onboarding section data — strict schema, only known fields accepted
const shortText = z.string().max(500).nullable();
const longText = z.string().max(5000).nullable();
const finiteNumber = z.coerce.number().finite().nullable();
const entryValue = z.union([
  z.string().max(5000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const entrySchema = z.record(z.string().max(100), entryValue);
const gapExplanationsSchema = z.union([
  longText,
  z.record(z.string().max(100), z.string().max(2000)),
]).nullable();

const onboardingSectionSchema = z.object({
  status: z.enum(['not_started', 'in_progress', 'completed', 'na']).optional(),
  date: dateSchema.optional(),
  expiry: dateSchema.optional(),
  reference: shortText.optional(),
  notes: longText.optional(),
  verified_by: shortText.optional(),
  verified_date: dateSchema.optional(),
  entries: z.array(entrySchema).max(100).optional(),

  address_proof_date: dateSchema.optional(),
  address_proof_type: shortText.optional(),
  adult_first_result: shortText.optional(),
  barred_list_checked: z.boolean().optional(),
  care_certificate_from_prev: z.boolean().optional(),
  check_date: dateSchema.optional(),
  checker_name: shortText.optional(),
  conditions_disclosed: z.boolean().optional(),
  contract_issued_date: dateSchema.optional(),
  contract_type: shortText.optional(),
  contracted_hours: finiteNumber.optional(),
  dbs_number: shortText.optional(),
  declaration_date: dateSchema.optional(),
  disclosure_level: shortText.optional(),
  document_number: shortText.optional(),
  document_type: shortText.optional(),
  expiry_date: dateSchema.optional(),
  follow_up_date: dateSchema.optional(),
  full_dbs_status: shortText.optional(),
  gap_explanations: gapExplanationsSchema.optional(),
  hourly_rate: finiteNumber.optional(),
  issue_date: dateSchema.optional(),
  job_title: shortText.optional(),
  last_online_check: dateSchema.optional(),
  nmc_expiry: dateSchema.optional(),
  nmc_pin: shortText.optional(),
  notice_period: shortText.optional(),
  oh_clearance_date: dateSchema.optional(),
  oh_referral_needed: z.boolean().optional(),
  overseas_check_applicable: z.boolean().optional(),
  overseas_check_country: shortText.optional(),
  overseas_check_date: dateSchema.optional(),
  overseas_check_obtained: z.boolean().optional(),
  overseas_check_reason: longText.optional(),
  photo_id_expiry: dateSchema.optional(),
  photo_id_number: shortText.optional(),
  photo_id_type: shortText.optional(),
  probation_end_date: dateSchema.optional(),
  restrictions: longText.optional(),
  review_date: dateSchema.optional(),
  risk_assessed_by: shortText.optional(),
  risk_assessment_date: dateSchema.optional(),
  risk_decision: shortText.optional(),
  risk_disclosure_nature: longText.optional(),
  risk_rationale: longText.optional(),
  self_declaration_date: dateSchema.optional(),
  self_declaration_obtained: z.boolean().optional(),
  signed_copy_received: z.union([dateSchema, z.boolean()]).optional(),
  start_date: dateSchema.optional(),
  trainer: shortText.optional(),
  update_service: z.boolean().optional(),
  update_service_ref: shortText.optional(),
  verification_date: dateSchema.optional(),
  fire_safety_orientation: z.boolean().optional(),
  emergency_procedures: z.boolean().optional(),
  safeguarding_briefing: z.boolean().optional(),
  moving_handling_basics: z.boolean().optional(),
  infection_control: z.boolean().optional(),
  building_orientation: z.boolean().optional(),
  it_system_induction: z.boolean().optional(),
  safeguarding_policy: z.boolean().optional(),
  whistleblowing_policy: z.boolean().optional(),
  data_protection_policy: z.boolean().optional(),
  social_media_policy: z.boolean().optional(),
  code_of_conduct: z.boolean().optional(),
  complaints_procedure: z.boolean().optional(),
}).strip().refine(
  (value) => JSON.stringify(value).length <= 50000,
  'Onboarding section payload is too large'
);

// GET /api/onboarding?home=X
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireOnboardingAccess('read'), async (req, res, next) => {
  try {
    const [onboarding, staffResult] = await Promise.all([
      onboardingRepo.findByHome(req.home.id),
      staffRepo.findByHome(req.home.id),
    ]);
    const staff = staffResult.rows.map(s => ({ id: s.id, name: s.name, role: s.role, team: s.team, active: s.active, start_date: s.start_date }));
    res.json({ onboarding: redactOnboardingForRole(req, onboarding), staff });
  } catch (err) { next(err); }
});

// PUT /api/onboarding/:staffId/:section?home=X — upsert section data
router.put('/:staffId/:section', writeRateLimiter, requireAuth, requireHomeAccess, requireOnboardingAccess('write'), async (req, res, next) => {
  try {
    const staffIdParsed = staffIdSchema.safeParse(req.params.staffId);
    const sectionParsed = sectionSchema.safeParse(req.params.section);
    if (!staffIdParsed.success || !sectionParsed.success) {
      return res.status(400).json({ error: 'Invalid staffId or section' });
    }
    const accessError = requireOnboardingSectionAccess(req, res, sectionParsed.data);
    if (accessError) return accessError;
    const bodyParsed = onboardingSectionSchema.safeParse(req.body);
    if (!bodyParsed.success) return zodError(res, bodyParsed);
    const staff = await staffRepo.findById(req.home.id, staffIdParsed.data);
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });
    const existingOnboarding = await onboardingRepo.findByStaffId(req.home.id, staffIdParsed.data);
    const beforeSection = existingOnboarding?.[sectionParsed.data] ?? null;
    const result = await onboardingRepo.upsertSection(req.home.id, staffIdParsed.data, sectionParsed.data, bodyParsed.data);
    const changedKeys = new Set([
      ...Object.keys(beforeSection || {}),
      ...Object.keys(bodyParsed.data || {}),
    ]);
    const changes = diffFields(beforeSection, bodyParsed.data, {
      extraSensitive: isSensitiveOnboardingSection(sectionParsed.data) ? changedKeys : undefined,
    });
    await auditService.log('onboarding_update', req.home.slug, req.user.username, { staffId: staffIdParsed.data, section: sectionParsed.data, changes });
    res.json(result);
  } catch (err) { next(err); }
});

// --- File attachment routes (static prefix first to avoid /:staffId/:section collision) ---

router.get('/files/:id/download', readRateLimiter, requireAuth, requireHomeAccess, requireOnboardingAccess('read'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid file ID' });
    const att = await onboardingAttachmentsRepo.findById(id, req.home.id);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    const accessError = requireOnboardingSectionAccess(req, res, att.section);
    if (accessError) return accessError;
    const uploadRoot = path.resolve(config.upload.dir);
    const filePath = path.resolve(path.join(
      config.upload.dir,
      String(req.home.id),
      'onboarding',
      safePath(att.staffId),
      safePath(att.section),
      att.stored_name
    ));
    if (!isPathInsideRoot(uploadRoot, filePath)) return res.status(403).json({ error: 'Forbidden' });
    await auditService.log('onboarding_attachment_download', req.home.slug, req.user.username, {
      fileId: id,
      staffId: att.staffId,
      section: att.section,
    });
    sendStoredDownload(res, next, filePath, {
      originalName: att.original_name,
      mimeType: att.mime_type,
    });
  } catch (err) { next(err); }
});

router.delete('/files/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireOnboardingAccess('write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid file ID' });
    const existing = await onboardingAttachmentsRepo.findById(id, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Attachment not found' });
    const accessError = requireOnboardingSectionAccess(req, res, existing.section);
    if (accessError) return accessError;
    const deleted = await onboardingAttachmentsRepo.softDelete(id, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Attachment not found' });
    await auditService.log('onboarding_attachment_delete', req.home.slug, req.user.username, {
      fileId: id,
      staffId: deleted.staffId,
      section: deleted.section,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/onboarding/:staffId/:section?home=X — clear section data
router.delete('/:staffId/:section', writeRateLimiter, requireAuth, requireHomeAccess, requireOnboardingAccess('write'), async (req, res, next) => {
  try {
    const staffIdParsed = staffIdSchema.safeParse(req.params.staffId);
    const sectionParsed = sectionSchema.safeParse(req.params.section);
    if (!staffIdParsed.success || !sectionParsed.success) {
      return res.status(400).json({ error: 'Invalid staffId or section' });
    }
    const accessError = requireOnboardingSectionAccess(req, res, sectionParsed.data);
    if (accessError) return accessError;
    const staff = await staffRepo.findById(req.home.id, staffIdParsed.data);
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });
    await onboardingRepo.clearSection(req.home.id, staffIdParsed.data, sectionParsed.data);
    await auditService.log('onboarding_clear', req.home.slug, req.user.username, { staffId: staffIdParsed.data, section: sectionParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// --- Per-staff-section file list and upload ---

router.get('/:staffId/:section/files', readRateLimiter, requireAuth, requireHomeAccess, requireOnboardingAccess('read'), async (req, res, next) => {
  try {
    const staffIdParsed = staffIdSchema.safeParse(req.params.staffId);
    const sectionParsed = sectionSchema.safeParse(req.params.section);
    if (!staffIdParsed.success || !sectionParsed.success) {
      return res.status(400).json({ error: 'Invalid staffId or section' });
    }
    const accessError = requireOnboardingSectionAccess(req, res, sectionParsed.data);
    if (accessError) return accessError;
    const staff = await staffRepo.findByIdIncludingDeleted(req.home.id, staffIdParsed.data);
    if (!staff) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    const files = await onboardingAttachmentsRepo.findAttachments(req.home.id, staffIdParsed.data, sectionParsed.data);
    res.json(files);
  } catch (err) { next(err); }
});

router.post('/:staffId/:section/files', writeRateLimiter, requireAuth, requireHomeAccess, requireOnboardingAccess('write'), async (req, res, next) => {
  try {
    const staffIdParsed = staffIdSchema.safeParse(req.params.staffId);
    const sectionParsed = sectionSchema.safeParse(req.params.section);
    if (!staffIdParsed.success || !sectionParsed.success) {
      return res.status(400).json({ error: 'Invalid staffId or section' });
    }
    const accessError = requireOnboardingSectionAccess(req, res, sectionParsed.data);
    if (accessError) return accessError;
    const staff = await staffRepo.findById(req.home.id, staffIdParsed.data);
    if (!staff) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    upload.single('file')(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 20MB)' });
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      try {
        await assertGenericAttachmentUploadSafe(req.file);
        const description = z.string().max(500).optional().safeParse(req.body.description);
        const attachment = await onboardingAttachmentsRepo.create(req.home.id, staffIdParsed.data, sectionParsed.data, {
          original_name: req.file.originalname,
          stored_name: req.file.filename,
          mime_type: req.file.mimetype,
          size_bytes: req.file.size,
          description: description.success ? (description.data || null) : null,
          uploaded_by: req.user.username,
        });
        await auditService.log('onboarding_attachment_upload', req.home.slug, req.user.username, {
          fileId: attachment.id,
          staffId: staffIdParsed.data,
          section: sectionParsed.data,
        });
        res.status(201).json(attachment);
      } catch (uploadErr) {
        await unlink(req.file.path).catch(() => {});
        next(uploadErr);
      }
    });
  } catch (err) { next(err); }
});

export default router;
