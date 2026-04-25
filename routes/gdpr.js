import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import * as homeRepo from '../repositories/homeRepo.js';  // kept for access-log optional home lookup
import { hasAccess, findHomeSlugsForUser, getHomeRole } from '../repositories/userHomeRepo.js';
import { hasModuleAccess } from '../shared/roles.js';
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

function buildSarAuditSummary(data) {
  const counts = Object.entries(data?.data || {})
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => [key, value.length])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([key, count]) => `${key}=${count}`)
    .join(', ');
  return `Gathered ${data?.subject_type || 'unknown'} data for ${data?.subject_id || 'unknown'}${counts ? ` (${counts})` : ''}`;
}

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

const processorBodySchema = z.object({
  provider_name: z.string().min(1).max(300),
  provider_role: z.enum(['processor', 'sub_processor']),
  services: z.string().max(5000).nullable().optional(),
  categories_of_data: z.string().min(1).max(500),
  categories_of_subjects: z.string().min(1).max(500),
  countries: z.string().max(500).nullable().optional(),
  international_transfers: z.boolean().optional(),
  dpa_status: z.enum(['draft', 'requested', 'signed', 'not_required', 'expired']).optional(),
  contract_owner: z.string().max(100).nullable().optional(),
  signed_date: dateSchema.optional(),
  review_due: dateSchema.optional(),
  notes: z.string().max(5000).nullable().optional(),
});

const processorUpdateSchema = processorBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

const dpComplaintBodySchema = z.object({
  date_received:    dateSchema,
  complainant_name: z.string().max(200).nullable().optional(),
  subject_type:     z.enum(['staff', 'resident']).nullable().optional(),
  subject_id:       z.string().min(1).max(100).nullable().optional(),
  category:         z.enum(['access', 'erasure', 'rectification', 'breach', 'consent', 'other']),
  description:      z.string().min(1).max(5000),
  severity:         z.enum(['low', 'medium', 'high', 'critical']).optional().default('low'),
  ico_involved:     z.boolean().optional().default(false),
}).refine(
  data => (!data.subject_type && !data.subject_id) || (data.subject_type && data.subject_id),
  { message: 'subject_type and subject_id must be provided together when linking a complaint to a subject' },
);

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
    await auditService.log('sar_gather', req.home.slug, req.user.username, buildSarAuditSummary(data));
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
// Permission: requires gdpr:read on the relevant home(s). Previously locked to JWT-claim
// admin role only; home managers and DPOs (deputy_manager) need this for SAR responses.
router.get('/access-log', readRateLimiter, requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const homeP = homeIdSchema.safeParse(req.query.home);
    const isPlatformAdmin = !!req.user?.is_platform_admin;
    let homeSlugs;
    if (homeP.success && homeP.data) {
      const home = await homeRepo.findBySlug(homeP.data);
      if (!home) return res.status(404).json({ error: 'Home not found' });
      const assignment = isPlatformAdmin ? null : await getHomeRole(req.user.username, home.id);
      if (!isPlatformAdmin && (!assignment || !hasModuleAccess(assignment.role_id, 'gdpr', 'read'))) {
        return res.status(403).json({ error: 'You do not have GDPR read access for this home' });
      }
      homeSlugs = [home.slug];
    } else {
      const allSlugs = await findHomeSlugsForUser(req.user.username);
      if (allSlugs.length === 0) return res.status(403).json({ error: 'No accessible homes for access log' });
      const eligible = [];
      for (const slug of allSlugs) {
        const home = await homeRepo.findBySlug(slug);
        if (!home) continue;
        if (isPlatformAdmin) { eligible.push(slug); continue; }
        const assignment = await getHomeRole(req.user.username, home.id);
        if (assignment && hasModuleAccess(assignment.role_id, 'gdpr', 'read')) eligible.push(slug);
      }
      if (eligible.length === 0) return res.status(403).json({ error: 'No GDPR read permission on any accessible home' });
      homeSlugs = eligible;
    }
    res.json(await gdprService.getAccessLog({ limit, offset, homeSlugs }));
  } catch (err) { next(err); }
});

// Processor register / DPA tracking
router.get('/processors', readRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'read'), async (req, res, next) => {
  try {
    res.json(await gdprService.findProcessors(req.home.id));
  } catch (err) { next(err); }
});

router.post('/processors', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const parsed = processorBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    if (parsed.data.dpa_status === 'signed' && !parsed.data.signed_date) {
      return res.status(400).json({ error: 'signed_date is required when DPA status is signed' });
    }
    const result = await gdprService.createProcessor(req.home.id, { ...parsed.data, created_by: req.user.username });
    await auditService.log('gdpr_create', req.home.slug, req.user.username, { id: result.id, entity: 'processor_register' });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.put('/processors/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid processor ID' });
    const parsed = processorUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const existing = await gdprService.findProcessorById(idP.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Processor record not found' });
    if ((parsed.data.dpa_status === 'signed' || (!('dpa_status' in parsed.data) && existing.dpa_status === 'signed'))
        && parsed.data.signed_date === null) {
      return res.status(400).json({ error: 'signed_date is required when DPA status is signed' });
    }
    const { version, payload } = splitVersion(parsed.data);
    const result = await gdprService.updateProcessor(idP.data, req.home.id, payload, version);
    if (result === null) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    const changes = diffFields(existing, result);
    await auditService.log('gdpr_processor_update', req.home.slug, req.user.username, { id: idP.data, changes });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
