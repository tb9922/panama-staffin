import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import * as complaintRepo from '../repositories/complaintRepo.js';
import * as complaintSurveyRepo from '../repositories/complaintSurveyRepo.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { nullableDateInput } from '../lib/zodHelpers.js';
import { definedWithoutVersion, splitVersion } from '../lib/versionedPayload.js';
import { validateComplaintStatusChange } from '../lib/statusTransitions.js';

const router = Router();
const idSchema = z.string().min(1).max(100);
const dateSchema = nullableDateInput;

const complaintBodySchema = z.object({
  date:                dateSchema,
  raised_by:           z.string().max(100).nullable().optional(),
  raised_by_name:      z.string().max(200).nullable().optional(),
  resident_id:         z.number().int().positive().nullable().optional(),
  category:            z.string().max(100).nullable().optional(),
  title:               z.string().min(1).max(500),
  description:         z.string().max(10000).nullable().optional(),
  acknowledged_date:   dateSchema.optional(),
  response_deadline:   dateSchema.optional(),
  status:              z.enum(['open', 'acknowledged', 'investigating', 'resolved', 'closed']),
  investigator:        z.string().max(200).nullable().optional(),
  investigation_notes: z.string().max(10000).nullable().optional(),
  resolution:          z.string().max(10000).nullable().optional(),
  resolution_date:     dateSchema.optional(),
  outcome_shared:      z.boolean().optional(),
  root_cause:          z.string().max(5000).nullable().optional(),
  improvements:        z.string().max(5000).nullable().optional(),
  lessons_learned:     z.string().max(5000).nullable().optional(),
});
const complaintUpdateSchema = complaintBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

const surveyBodySchema = z.object({
  type:                 z.string().max(100).nullable().optional(),
  date:                 dateSchema,
  title:                z.string().min(1).max(500),
  total_sent:           z.coerce.number().int().min(0).nullable().optional(),
  responses:            z.coerce.number().int().min(0).nullable().optional(),
  overall_satisfaction: z.coerce.number().min(1).max(5).nullable().optional(),
  area_scores:          z.record(z.string(), z.coerce.number()).optional(),
  key_feedback:         z.string().max(10000).nullable().optional(),
  actions:              z.string().max(10000).nullable().optional(),
  conducted_by:         z.string().max(200).nullable().optional(),
});
const surveyUpdateSchema = surveyBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

// GET /api/complaints?home=X
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const [complaintsResult, surveysResult] = await Promise.all([
      complaintRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset }),
      complaintSurveyRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset }),
    ]);
    let complaints = complaintsResult.rows;
    const surveys = surveysResult.rows;
    const complaintCategories = req.home.config?.complaint_categories || [];
    // Strip GDPR-sensitive fields for non-admin viewers
    if (req.homeRole !== 'home_manager' && req.homeRole !== 'deputy_manager') {
      complaints = complaints.map(c => {
        const {
          raised_by_name: _a, investigator: _b, investigation_notes: _c,
          root_cause: _d, improvements: _e, lessons_learned: _f,
          ...safe
        } = c;
        return safe;
      });
    }
    res.json({ complaints, surveys, complaintCategories, _total: complaintsResult.total });
  } catch (err) { next(err); }
});

// POST /api/complaints?home=X
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = complaintBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    // Strip any client-supplied id — server generates it to prevent undelete of soft-deleted records
    const { id: _id, ...complaintBody } = parsed.data;
    const complaint = await complaintRepo.upsert(req.home.id, { ...complaintBody, reported_by: req.user.username });
    await auditService.log('complaint_create', req.home.slug, req.user.username, { id: complaint?.id });
    res.status(201).json(complaint);
  } catch (err) { next(err); }
});

// PUT /api/complaints/:id?home=X
router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = complaintUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    // Only send fields that were actually provided in the request body
    const updates = definedWithoutVersion(parsed.data);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });
    const existing = await complaintRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const statusError = validateComplaintStatusChange(existing, updates);
    if (statusError) return res.status(400).json({ error: statusError });
    const { version } = splitVersion(parsed.data);
    const complaint = await complaintRepo.update(idParsed.data, req.home.id, updates, version);
    if (complaint === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    // Redact description text from audit diff — complaints routinely contain resident
    // health context, safeguarding narrative, and family dispute detail. Article 9.
    const changes = diffFields(existing, complaint, { extraSensitive: ['description', 'resolution', 'investigation_notes'] });
    await auditService.log('complaint_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
    res.json(complaint);
  } catch (err) { next(err); }
});

// DELETE /api/complaints/:id?home=X
router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await complaintRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await auditService.log('complaint_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/complaints/surveys?home=X
router.post('/surveys', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = surveyBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    // Strip any client-supplied id — server generates it to prevent undelete of soft-deleted records
    const { id: _id, ...surveyBody } = parsed.data;
    const survey = await complaintSurveyRepo.upsert(req.home.id, surveyBody);
    await auditService.log('survey_create', req.home.slug, req.user.username, { id: survey?.id });
    res.status(201).json(survey);
  } catch (err) { next(err); }
});

// PUT /api/complaints/surveys/:id?home=X
router.put('/surveys/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = surveyUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const updates = definedWithoutVersion(parsed.data);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });
    const existing = await complaintSurveyRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { version } = splitVersion(parsed.data);
    const survey = await complaintSurveyRepo.update(idParsed.data, req.home.id, updates, version);
    if (survey === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, survey);
    await auditService.log('survey_update', req.home.slug, req.user.username, { id: idParsed.data, changes });
    res.json(survey);
  } catch (err) { next(err); }
});

// DELETE /api/complaints/surveys/:id?home=X
router.delete('/surveys/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await complaintSurveyRepo.softDelete(idParsed.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await auditService.log('survey_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
