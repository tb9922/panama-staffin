import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import * as incidentRepo from '../repositories/incidentRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { dispatchEvent } from '../services/webhookService.js';

const router = Router();
const incidentIdSchema = z.string().min(1).max(100);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const addendumSchema = z.object({ content: z.string().min(1).max(5000) });

const incidentBodySchema = z.object({
  date:                       dateSchema,
  time:                       z.string().max(10).nullable().optional(),
  location:                   z.string().max(500).nullable().optional(),
  type:                       z.string().min(1).max(200),
  severity:                   z.enum(['minor', 'moderate', 'serious', 'major', 'catastrophic']),
  description:                z.string().max(10000).nullable().optional(),
  person_affected:            z.string().max(100).nullable().optional(),
  person_affected_name:       z.string().max(200).nullable().optional(),
  staff_involved:             z.array(z.string().max(20)).max(100).optional(),
  immediate_action:           z.string().max(5000).nullable().optional(),
  medical_attention:          z.boolean().optional(),
  hospital_attendance:        z.boolean().optional(),
  cqc_notifiable:             z.boolean().optional(),
  cqc_notification_type:      z.enum(['death', 'serious_injury', 'abuse_allegation', 'police', 'deprivation_of_liberty', 'seclusion_restraint', 'other']).nullable().optional(),
  cqc_notification_deadline:  z.union([z.enum(['immediate', '72h']), dateSchema]).optional(),
  cqc_notified:               z.boolean().optional(),
  cqc_notified_date:          dateSchema.optional(),
  cqc_reference:              z.string().max(200).nullable().optional(),
  riddor_reportable:          z.boolean().optional(),
  riddor_category:            z.enum(['death', 'specified_injury', 'over_7_day', 'dangerous_occurrence']).nullable().optional(),
  riddor_reported:            z.boolean().optional(),
  riddor_reported_date:       dateSchema.optional(),
  riddor_reference:           z.string().max(200).nullable().optional(),
  safeguarding_referral:      z.boolean().optional(),
  safeguarding_to:            z.string().max(500).nullable().optional(),
  safeguarding_reference:     z.string().max(200).nullable().optional(),
  safeguarding_date:          dateSchema.optional(),
  witnesses:                  z.array(z.object({
    name:              z.string().max(200),
    role:              z.string().max(100).nullable().optional(),
    statement_summary: z.string().max(5000).nullable().optional(),
  })).max(50).optional(),
  duty_of_candour_applies:    z.boolean().optional(),
  candour_notification_date:  dateSchema.optional(),
  candour_letter_sent_date:   dateSchema.optional(),
  candour_recipient:          z.string().max(200).nullable().optional(),
  police_involved:            z.boolean().optional(),
  police_reference:           z.string().max(200).nullable().optional(),
  police_contact_date:        dateSchema.optional(),
  msp_wishes_recorded:        z.boolean().optional(),
  msp_outcome_preferences:    z.string().max(5000).nullable().optional(),
  msp_person_involved:        z.string().max(200).nullable().optional(),
  investigation_status:       z.enum(['open', 'under_review', 'closed']).optional(),
  investigation_start_date:   dateSchema.optional(),
  investigation_lead:         z.string().max(200).nullable().optional(),
  investigation_review_date:  dateSchema.optional(),
  root_cause:                 z.string().max(5000).nullable().optional(),
  lessons_learned:            z.string().max(5000).nullable().optional(),
  investigation_closed_date:  dateSchema.optional(),
  corrective_actions:         z.array(z.object({
    description:    z.string().max(2000),
    assigned_to:    z.string().max(200).nullable().optional(),
    due_date:       dateSchema.optional(),
    completed_date: dateSchema.optional(),
    status:         z.string().max(50).nullable().optional(),
  })).max(100).optional(),
});
const incidentUpdateSchema = incidentBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

// GET /api/incidents?home=X
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const [incidentsResult, staffResult] = await Promise.all([
      incidentRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset }),
      staffRepo.findByHome(req.home.id),
    ]);
    let incidents = incidentsResult.rows;
    const incidentTypes = req.home.config?.incident_types || [];
    const staff = staffResult.rows.filter(s => s.active !== false).map(s => ({ id: s.id, name: s.name, role: s.role }));
    // Strip GDPR-sensitive fields for non-admin viewers (safety handover summary preserved)
    if (req.homeRole !== 'home_manager' && req.homeRole !== 'deputy_manager') {
      incidents = incidents.map(inc => {
        const {
          investigation_lead: _a, investigation_review_date: _b, root_cause: _c,
          lessons_learned: _d, investigation_closed_date: _e, investigation_start_date: _f,
          safeguarding_to: _g, safeguarding_reference: _h, safeguarding_date: _i,
          police_reference: _j, police_contact_date: _k,
          riddor_reference: _l, riddor_reported_date: _m,
          cqc_reference: _n,
          candour_notification_date: _p, candour_letter_sent_date: _q, candour_recipient: _r,
          msp_outcome_preferences: _s, msp_person_involved: _t,
          witnesses: _u,
          ...safe
        } = inc;
        return safe;
      });
    }
    res.json({ incidents, incidentTypes, staff, _total: incidentsResult.total });
  } catch (err) { next(err); }
});

// POST /api/incidents?home=X
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = incidentBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const incident = await incidentRepo.upsert(req.home.id, { ...parsed.data, reported_by: req.user.username });
    if (!incident) {
      return res.status(409).json({ error: 'Incident is frozen and cannot be modified' });
    }
    await auditService.log('incident_create', req.home.slug, req.user.username, { id: incident.id });
    dispatchEvent(req.home.id, 'incident.created', { incidentId: incident.id, severity: parsed.data.severity, type: parsed.data.type });
    res.status(201).json(incident);
  } catch (err) { next(err); }
});

// PUT /api/incidents/:id?home=X
router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = incidentIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid incident ID' });
    const parsed = incidentUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    // Only send fields that were actually provided in the request body
    const updates = Object.fromEntries(
      Object.entries(parsed.data).filter(([_, v]) => v !== undefined)
    );
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });
    const existing = await incidentRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Incident not found or frozen' });
    const version = parsed.data._version != null ? parsed.data._version : null;
    const incident = await incidentRepo.update(idParsed.data, req.home.id, updates, version);
    if (incident === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, incident);
    await auditService.log('incident_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
    res.json(incident);
  } catch (err) { next(err); }
});

// DELETE /api/incidents/:id?home=X
router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = incidentIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid incident ID' });
    const deleted = await incidentRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Incident not found or frozen' });
    await auditService.log('incident_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/incidents/:id/freeze?home=X
router.post('/:id/freeze', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = incidentIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid incident ID' });
    const frozen = await incidentRepo.freeze(idParsed.data, req.home.id);
    if (!frozen) return res.status(404).json({ error: 'Incident not found or already frozen' });
    await auditService.log('incident_freeze', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/incidents/:id/addenda?home=X
router.get('/:id/addenda', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const idParsed = incidentIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid incident ID' });
    const addenda = await incidentRepo.getAddenda(idParsed.data, req.home.id);
    res.json(addenda);
  } catch (err) { next(err); }
});

// POST /api/incidents/:id/addenda?home=X
router.post('/:id/addenda', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = incidentIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid incident ID' });
    const parsed = addendumSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const addendum = await incidentRepo.addAddendum(idParsed.data, req.home.id, req.user.username, parsed.data.content);
    await auditService.log('incident_addendum', req.home.slug, req.user.username, { id: idParsed.data });
    res.json(addendum);
  } catch (err) { next(err); }
});

export default router;
