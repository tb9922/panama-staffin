import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as gdprService from '../services/gdprService.js';
import * as auditService from '../services/auditService.js';

const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid home ID').max(100).optional();
const idSchema = z.coerce.number().int().positive();
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

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
});

const breachBodySchema = z.object({
  title:                     z.string().min(1).max(300),
  description:               z.string().max(5000).nullable().optional(),
  discovered_date:           z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/),
  data_categories:           z.array(z.string()).optional().default([]),
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
});

const consentBodySchema = z.object({
  subject_type:  z.enum(['staff', 'resident']),
  subject_id:    z.string().min(1).max(100),
  subject_name:  z.string().max(200).nullable().optional(),
  purpose:       z.string().min(1).max(200),
  legal_basis:   z.enum(['consent', 'contract', 'legal_obligation', 'vital_interests', 'public_task', 'legitimate_interests']),
  given:         z.string().nullable().optional(),
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
});

// ── Helper ───────────────────────────────────────────────────────────────────

async function resolveHome(req, res) {
  const parsed = homeIdSchema.safeParse(req.query.home);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid home parameter' }); return null; }
  if (!parsed.data)    { res.status(400).json({ error: 'home parameter is required' }); return null; }
  const home = await homeRepo.findBySlug(parsed.data);
  if (!home) { res.status(404).json({ error: 'Home not found' }); return null; }
  return home;
}

// ── Data Requests (SAR/Erasure/etc.) ─────────────────────────────────────────

// GET /api/gdpr/requests?home=X
router.get('/requests', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    res.json(await gdprService.findRequests(home.id));
  } catch (err) { next(err); }
});

// POST /api/gdpr/requests?home=X
router.post('/requests', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = requestBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    res.status(201).json(await gdprService.createRequest(home.id, parsed.data));
  } catch (err) { next(err); }
});

// PUT /api/gdpr/requests/:id?home=X
router.put('/requests/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid request ID' });
    const parsed = requestUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await gdprService.updateRequest(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Request not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/gdpr/requests/:id/gather — trigger SAR data export
router.post('/requests/:id/gather', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid request ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const request = await gdprService.findRequestById(idP.data);
    if (!request || request.home_id !== home.id) return res.status(404).json({ error: 'Request not found' });
    const data = await gdprService.gatherPersonalData(request.subject_type, request.subject_id, home.id, null, request.subject_name);
    await auditService.log('sar_gather', home.slug, req.user.username,
      `Gathered ${request.subject_type} data for ${request.subject_id}`);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/gdpr/requests/:id/execute — execute erasure
router.post('/requests/:id/execute', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid request ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const request = await gdprService.findRequestById(idP.data);
    if (!request || request.home_id !== home.id) return res.status(404).json({ error: 'Request not found' });
    if (request.request_type !== 'erasure') {
      return res.status(400).json({ error: 'Only erasure requests can be executed' });
    }
    if (!request.identity_verified) {
      return res.status(400).json({ error: 'Identity must be verified before erasure' });
    }
    const result = await gdprService.executeErasure(
      request.subject_id, home.id, idP.data, req.user.username, home.slug
    );
    res.json(result);
  } catch (err) { next(err); }
});

// ── Data Breaches ────────────────────────────────────────────────────────────

// GET /api/gdpr/breaches?home=X
router.get('/breaches', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    res.json(await gdprService.findBreaches(home.id));
  } catch (err) { next(err); }
});

// POST /api/gdpr/breaches?home=X
router.post('/breaches', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = breachBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    res.status(201).json(await gdprService.createBreach(home.id, parsed.data));
  } catch (err) { next(err); }
});

// PUT /api/gdpr/breaches/:id?home=X
router.put('/breaches/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid breach ID' });
    const parsed = breachUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await gdprService.updateBreach(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Breach not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/gdpr/breaches/:id/assess — risk assessment
router.post('/breaches/:id/assess', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid breach ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const breach = await gdprService.findBreachById(idP.data, home.id);
    if (!breach) return res.status(404).json({ error: 'Breach not found' });
    const assessment = gdprService.assessBreachRisk(breach);
    // Auto-update breach with assessment results + ICO notification deadline
    const updates = { ico_notifiable: assessment.icoNotifiable };
    if (assessment.icoNotifiable && assessment.icoDeadline) {
      updates.ico_notification_deadline = assessment.icoDeadline;
    }
    await gdprService.updateBreach(idP.data, home.id, updates);
    res.json(assessment);
  } catch (err) { next(err); }
});

// ── Retention Schedule ───────────────────────────────────────────────────────

// GET /api/gdpr/retention — schedule + optional scan
router.get('/retention', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (req.query.scan === 'true') {
      const home = await resolveHome(req, res);
      if (!home) return;
      res.json(await gdprService.scanRetention(home.id));
    } else {
      res.json(await gdprService.getRetentionSchedule());
    }
  } catch (err) { next(err); }
});

// ── Consent Records ──────────────────────────────────────────────────────────

// GET /api/gdpr/consent?home=X
router.get('/consent', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    res.json(await gdprService.findConsent(home.id));
  } catch (err) { next(err); }
});

// POST /api/gdpr/consent?home=X
router.post('/consent', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = consentBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    res.status(201).json(await gdprService.createConsent(home.id, parsed.data));
  } catch (err) { next(err); }
});

// PUT /api/gdpr/consent/:id?home=X
router.put('/consent/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid consent ID' });
    const parsed = z.object({
      withdrawn: z.string().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await gdprService.updateConsent(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Consent record not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// ── DP Complaints ────────────────────────────────────────────────────────────

// GET /api/gdpr/complaints?home=X
router.get('/complaints', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    res.json(await gdprService.findDPComplaints(home.id));
  } catch (err) { next(err); }
});

// POST /api/gdpr/complaints?home=X
router.post('/complaints', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = dpComplaintBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    res.status(201).json(await gdprService.createDPComplaint(home.id, parsed.data));
  } catch (err) { next(err); }
});

// PUT /api/gdpr/complaints/:id?home=X
router.put('/complaints/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid complaint ID' });
    const parsed = dpComplaintUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await gdprService.updateDPComplaint(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Complaint not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// ── Access Log ───────────────────────────────────────────────────────────────

// GET /api/gdpr/access-log?home=X — access log scoped to home when ?home= provided
router.get('/access-log', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const homeP = homeIdSchema.safeParse(req.query.home);
    if (!homeP.success) return res.status(400).json({ error: 'Invalid home parameter' });
    let homeSlug;
    if (homeP.data) {
      const home = await homeRepo.findBySlug(homeP.data);
      if (!home) return res.status(404).json({ error: 'Home not found' });
      homeSlug = home.slug;
    }
    res.json(await gdprService.getAccessLog({ limit, offset, homeSlug }));
  } catch (err) { next(err); }
});

export default router;
