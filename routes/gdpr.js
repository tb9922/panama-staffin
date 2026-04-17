import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import * as homeRepo from '../repositories/homeRepo.js';  // kept for access-log optional home lookup
import { hasAccess, findHomeSlugsForUser } from '../repositories/userHomeRepo.js';
import * as gdprService from '../services/gdprService.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { nullableDateInput } from '../lib/zodHelpers.js';
import { splitVersion } from '../lib/versionedPayload.js';
import {
  validateGdprBreachStatusChange,
  validateGdprComplaintStatusChange,
  validateGdprRequestStatusChange,
} from '../lib/statusTransitions.js';

const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid home ID').max(100).optional();
const idSchema = z.coerce.number().int().positive();
const dateSchema = nullableDateInput;

const requestBodySchema = z.object({
  request_type:      z.enum(['sar', 'erasure', 'rectification', 'restriction', 'portability']),
  subject_type:      z.enum(['staff', 'resident']),
  subject_id:        z.string().min(1).max(100),
  subject_name:      z.string().max(200).nullable().optional(),
  date_received:     dateSchema,
  deadline:          dateSchema,
  identity_verified: z.boolean().optional().default(false),
  notes:             z.string().max(2000).nullable().optional(),
});

const requestUpdateSchema = z.object({
  status:            z.enum(['received', 'in_progress', 'completed', 'rejected']).optional(),
  identity_verified: z.boolean().optional(),
  notes:             z.string().max(2000).nullable().optional(),
  completed_date:    dateSchema.optional(),
  completed_by:      z.string().max(100).optional(),
  _version:          z.number().int().nonnegative().optional(),
});

const breachBodySchema = z.object({
  title:                     z.string().min(1).max(300),
  description:               z.string().max(5000).nullable().optional(),
  discovered_date:           z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/),
  data_categories:           z.array(z.string().max(200)).max(50).optional().default([]),
  individuals_affected:      z.number().int().nonnegative().optional().default(0),
  severity:                  z.enum(['low', 'medium', 'high', 'critical']).optional().default('low'),
  risk_to_rights:            z.enum(['unlikely', 'possible', 'likely', 'high']).optional().default('unlikely'),
  containment_actions:       z.string().max(5000).nullable().optional(),
});

const breachUpdateSchema = z.object({
  title:              z.string().min(1).max(300).optional(),
  description:        z.string().max(5000).nullable().optional(),
  severity:           z.enum(['low', 'medium', 'high', 'critical']).optional(),
  risk_to_rights:     z.enum(['unlikely', 'possible', 'likely', 'high']).optional(),
  ico_notifiable:     z.boolean().optional(),
  ico_notified:       z.boolean().optional(),
  ico_notified_date:  dateSchema.optional(),
  ico_reference:      z.string().max(100).optional(),
  containment_actions: z.string().max(5000).nullable().optional(),
  root_cause:         z.string().max(5000).nullable().optional(),
  preventive_measures: z.string().max(5000).nullable().optional(),
  status:             z.enum(['open', 'contained', 'resolved', 'closed']).optional(),
  // ICO breach decision record fields
  recommended_ico_notification: z.boolean().optional(),
  manual_decision:    z.boolean().optional(),
  decision_by:        z.string().max(100).optional(),
  decision_at:        dateSchema.optional(),
  decision_rationale: z.string().max(5000).nullable().optional(),
  _version:           z.number().int().nonnegative().optional(),
});

const consentBodySchema = z.object({
  subject_type:  z.enum(['staff', 'resident']),
  subject_id:    z.string().min(1).max(100),
  subject_name:  z.string().max(200).nullable().optional(),
  purpose:       z.string().min(1).max(200),
  legal_basis:   z.enum(['consent', 'contract', 'legal_obligation', 'vital_interests', 'public_task', 'legitimate_interests']),
  given:         z.string().max(100).nullable().optional(),
  notes:         z.string().max(2000).nullable().optional(),
});

const dpComplaintBodySchema = z.object({
  date_received:    dateSchema,
  complainant_name: z.string().max(200).nullable().optional(),
  category:         z.enum(['access', 'erasure', 'rectification', 'breach', 'consent', 'other']),
  description:      z.string().min(1).max(5000),
  severity:         z.enum(['low', 'medium', 'high', 'critical']).optional().default('low'),
  ico_involved:     z.boolean().optional().default(false),
});

const dpComplaintUpdateSchema = z.object({
  status:          z.enum(['open', 'investigating', 'resolved', 'closed', 'escalated']).optional(),
  severity:        z.enum(['low', 'medium', 'high', 'critical']).optional(),
  ico_involved:    z.boolean().optional(),
  ico_reference:   z.string().max(100).optional(),
  resolution:      z.string().max(5000).nullable().optional(),
  resolution_date: dateSchema.optional(),
  _version:        z.number().int().nonnegative().optional(),
});

// ── Data Requests (SAR/Erasure/etc.) ─────────────────────────────────────────

// GET /api/gdpr/requests?home=X
router.get('/requests', readRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'read'), async (req, res, next) => {
  try {
    res.json(await gdprService.findRequests(req.home.id));
  } catch (err) { next(err); }
});

// POST /api/gdpr/requests?home=X
router.post('/requests', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const parsed = requestBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await gdprService.createRequest(req.home.id, parsed.data);
    await auditService.log('gdpr_create', req.home.slug, req.user.username, { id: result.id, entity: 'data_request' });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PUT /api/gdpr/requests/:id?home=X
router.put('/requests/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid request ID' });
    const parsed = requestUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const existing = await gdprService.findRequestById(idP.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Request not found' });
    if (parsed.data.status === 'completed' && existing.request_type === 'erasure') {
      return res.status(400).json({ error: 'Erasure requests must be completed via /execute, not manually' });
    }
    const statusError = validateGdprRequestStatusChange(existing, parsed.data);
    if (statusError) return res.status(400).json({ error: statusError });
    const { version, payload } = splitVersion(parsed.data);
    const result = await gdprService.updateRequest(idP.data, req.home.id, payload, null, version);
    if (result === null) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    const changes = diffFields(existing, result);
    await auditService.log('gdpr_request_update', req.home.slug, req.user.username, { id: idP.data, changes });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/gdpr/requests/:id/gather — trigger SAR data export
router.post('/requests/:id/gather', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid request ID' });
    const request = await gdprService.findRequestById(idP.data, req.home.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!request.identity_verified) {
      return res.status(400).json({ error: 'Identity must be verified before gathering personal data' });
    }
    if (request.subject_type === 'resident' && !request.subject_name?.trim()) {
      return res.status(400).json({ error: 'Resident name is required for resident data gathering. Update the request with the resident name before gathering.' });
    }
    const data = await gdprService.gatherPersonalData(request.subject_type, request.subject_id, req.home.id, null, request.subject_name);
    await auditService.log('sar_gather', req.home.slug, req.user.username,
      `Gathered ${request.subject_type} data for ${request.subject_id}`);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/gdpr/requests/:id/execute — execute erasure
router.post('/requests/:id/execute', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid request ID' });
    const request = await gdprService.findRequestById(idP.data, req.home.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.request_type !== 'erasure') {
      return res.status(400).json({ error: 'Only erasure requests can be executed' });
    }
    if (!request.identity_verified) {
      return res.status(400).json({ error: 'Identity must be verified before erasure' });
    }
    if (request.subject_type === 'resident' && !request.subject_name?.trim()) {
      return res.status(400).json({ error: 'Resident name is required for resident erasure. Update the request with the resident name before executing.' });
    }
    let result;
    if (request.subject_type === 'staff') {
      result = await gdprService.executeErasure(
        request.subject_id, req.home.id, idP.data, req.user.username, req.home.slug
      );
    } else if (request.subject_type === 'resident') {
      result = await gdprService.executeResidentErasure(
        request.subject_id, req.home.id, idP.data, req.user.username, req.home.slug, request.subject_name
      );
    } else {
      return res.status(400).json({ error: `Unsupported subject type: ${request.subject_type}` });
    }
    res.json(result);
  } catch (err) { next(err); }
});

// ── Data Breaches ────────────────────────────────────────────────────────────

// GET /api/gdpr/breaches?home=X
router.get('/breaches', readRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'read'), async (req, res, next) => {
  try {
    res.json(await gdprService.findBreaches(req.home.id));
  } catch (err) { next(err); }
});

// POST /api/gdpr/breaches?home=X
router.post('/breaches', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const parsed = breachBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await gdprService.createBreach(req.home.id, parsed.data);
    await auditService.log('gdpr_create', req.home.slug, req.user.username, { id: result.id, entity: 'data_breach' });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PUT /api/gdpr/breaches/:id?home=X
router.put('/breaches/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid breach ID' });
    const parsed = breachUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const existing = await gdprService.findBreachById(idP.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Breach not found' });
    const statusError = validateGdprBreachStatusChange(existing, parsed.data);
    if (statusError) return res.status(400).json({ error: statusError });
    // Require rationale when human decision overrides the AI recommendation
    if ('manual_decision' in parsed.data && existing.recommended_ico_notification != null
        && parsed.data.manual_decision !== existing.recommended_ico_notification
        && !parsed.data.decision_rationale?.trim()) {
      return res.status(400).json({ error: 'Decision rationale is required when overriding the ICO notification recommendation' });
    }
    const { version, payload } = splitVersion(parsed.data);
    const result = await gdprService.updateBreach(idP.data, req.home.id, payload, version);
    if (result === null) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    const changes = diffFields(existing, result);
    await auditService.log('gdpr_breach_update', req.home.slug, req.user.username, { id: idP.data, changes });
    // Additional audit entry for ICO decision overrides
    if ('manual_decision' in parsed.data && existing.recommended_ico_notification != null
        && parsed.data.manual_decision !== existing.recommended_ico_notification) {
      await auditService.log('breach_ico_override', req.home.slug, req.user.username, {
        id: idP.data, recommended: existing.recommended_ico_notification,
        decision: parsed.data.manual_decision, rationale: parsed.data.decision_rationale,
      });
    }
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/gdpr/breaches/:id/assess — risk assessment
router.post('/breaches/:id/assess', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid breach ID' });
    const breach = await gdprService.findBreachById(idP.data, req.home.id);
    if (!breach) return res.status(404).json({ error: 'Breach not found' });
    const assessment = gdprService.assessBreachRisk(breach);
    // Only update the recommendation field; do NOT overwrite ico_notifiable if a
    // manual decision has already been recorded (manual_decision takes precedence).
    const updates = { recommended_ico_notification: assessment.icoNotifiable };
    if (breach.manual_decision == null) {
      updates.ico_notifiable = assessment.icoNotifiable;
    }
    if (assessment.icoNotifiable && assessment.icoDeadline) {
      updates.ico_notification_deadline = assessment.icoDeadline;
    }
    // Pass current version for optimistic locking — prevents overwriting concurrent edits.
    const result = await gdprService.updateBreach(idP.data, req.home.id, updates, breach.version);
    if (result === null) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    await auditService.log('gdpr_update', req.home.slug, req.user.username, { id: idP.data, entity: 'data_breach', action: 'risk_assessment' });
    res.json(assessment);
  } catch (err) { next(err); }
});

// ── Retention Schedule ───────────────────────────────────────────────────────

// GET /api/gdpr/retention — schedule + optional scan
// Retention schedule is global (not per-home), but gated by GDPR module access.
router.get('/retention', readRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'read'), async (req, res, next) => {
  try {
    if (req.query.scan === 'true') {
      if (!req.query.home) return res.status(400).json({ error: 'home parameter required for scan' });
      const home = await homeRepo.findBySlug(req.query.home);
      if (!home) return res.status(404).json({ error: 'Home not found' });
      const allowed = await hasAccess(req.user.username, home.id);
      if (!allowed) return res.status(403).json({ error: 'You do not have access to this home' });
      res.json(await gdprService.scanRetention(home.id));
    } else {
      res.json(await gdprService.getRetentionSchedule());
    }
  } catch (err) { next(err); }
});

// ── Consent Records ──────────────────────────────────────────────────────────

// GET /api/gdpr/consent?home=X
router.get('/consent', readRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'read'), async (req, res, next) => {
  try {
    res.json(await gdprService.findConsent(req.home.id));
  } catch (err) { next(err); }
});

// POST /api/gdpr/consent?home=X
router.post('/consent', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const parsed = consentBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await gdprService.createConsent(req.home.id, parsed.data);
    await auditService.log('gdpr_create', req.home.slug, req.user.username, { id: result.id, entity: 'consent_record' });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PUT /api/gdpr/consent/:id?home=X
router.put('/consent/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid consent ID' });
    const parsed = z.object({
      withdrawn: z.string().max(100).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      _version: z.number().int().nonnegative().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const existing = await gdprService.findConsentById(idP.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Consent record not found' });
    const { version, payload } = splitVersion(parsed.data);
    const result = await gdprService.updateConsent(idP.data, req.home.id, payload, version);
    if (result === null) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    const changes = diffFields(existing, result);
    await auditService.log('gdpr_consent_update', req.home.slug, req.user.username, { id: idP.data, changes });
    res.json(result);
  } catch (err) { next(err); }
});

// ── DP Complaints ────────────────────────────────────────────────────────────

// GET /api/gdpr/complaints?home=X
router.get('/complaints', readRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'read'), async (req, res, next) => {
  try {
    res.json(await gdprService.findDPComplaints(req.home.id));
  } catch (err) { next(err); }
});

// POST /api/gdpr/complaints?home=X
router.post('/complaints', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const parsed = dpComplaintBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await gdprService.createDPComplaint(req.home.id, parsed.data);
    await auditService.log('gdpr_create', req.home.slug, req.user.username, { id: result.id, entity: 'dp_complaint' });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PUT /api/gdpr/complaints/:id?home=X
router.put('/complaints/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid complaint ID' });
    const parsed = dpComplaintUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const existing = await gdprService.findDPComplaintById(idP.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Complaint not found' });
    const statusError = validateGdprComplaintStatusChange(existing, parsed.data);
    if (statusError) return res.status(400).json({ error: statusError });
    const { version, payload } = splitVersion(parsed.data);
    const result = await gdprService.updateDPComplaint(idP.data, req.home.id, payload, version);
    if (result === null) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    const changes = diffFields(existing, result);
    await auditService.log('gdpr_complaint_update', req.home.slug, req.user.username, { id: idP.data, changes });
    res.json(result);
  } catch (err) { next(err); }
});

// ── Access Log ───────────────────────────────────────────────────────────────

// GET /api/gdpr/access-log?home=X — access log scoped to home (or user's homes if omitted)
router.get('/access-log', readRateLimiter, requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const homeP = homeIdSchema.safeParse(req.query.home);
    let homeSlugs;
    if (homeP.success && homeP.data) {
      const home = await homeRepo.findBySlug(homeP.data);
      if (!home) return res.status(404).json({ error: 'Home not found' });
      const allowed = await hasAccess(req.user.username, home.id);
      if (!allowed) return res.status(403).json({ error: 'You do not have access to this home' });
      homeSlugs = [home.slug];
    } else {
      homeSlugs = await findHomeSlugsForUser(req.user.username);
    }
    res.json(await gdprService.getAccessLog({ limit, offset, homeSlugs }));
  } catch (err) { next(err); }
});

export default router;
