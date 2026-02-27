import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { createReadStream, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { config } from '../config.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as hrService from '../services/hrService.js';
import * as auditService from '../services/auditService.js';

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

// ── Shared Schemas ──────────────────────────────────────────────────────────

const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid home ID').max(100).optional();
const idSchema = z.coerce.number().int().positive();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const staffIdSchema = z.string().min(1).max(20);
const caseTypeSchema = z.enum([
  'disciplinary', 'grievance', 'performance', 'rtw_interview',
  'oh_referral', 'contract', 'family_leave', 'flexible_working',
  'edi', 'tupe', 'renewal',
]);

// ── Disciplinary Schemas ────────────────────────────────────────────────────

const disciplinaryBodySchema = z.object({
  staff_id:             staffIdSchema,
  date_raised:          dateSchema,
  category:             z.enum(['misconduct','gross_misconduct']),
  allegation_summary:   z.string().min(1).max(5000),
  status:               z.enum(['open','investigation','hearing_scheduled','outcome_issued','appeal_pending','appeal_complete','closed','withdrawn']).optional(),
  severity:             z.string().max(50).optional(),
  investigating_manager: z.string().max(200).optional(),
  investigation_start_date: dateSchema.optional(),
  investigation_end_date:   dateSchema.optional(),
  hearing_date:         dateSchema.optional(),
  hearing_panel:        z.string().max(500).optional(),
  outcome:              z.enum(['no_action','verbal_warning','first_written','final_written','dismissal','demotion','transfer']).optional(),
  outcome_date:         dateSchema.optional(),
  sanction_type:        z.string().max(100).optional(),
  sanction_expiry:      dateSchema.optional(),
  appeal_date:          dateSchema.optional(),
  appeal_outcome:       z.string().max(100).optional(),
  appeal_outcome_date:  dateSchema.optional(),
  acas_code_followed:   z.boolean().optional(),
  notes:                z.string().max(5000).nullable().optional(),
});

const disciplinaryUpdateSchema = z.object({
  date_raised:          dateSchema.optional(),
  category:             z.enum(['misconduct','gross_misconduct']).optional(),
  allegation_summary:   z.string().min(1).max(5000).optional(),
  status:               z.enum(['open','investigation','hearing_scheduled','outcome_issued','appeal_pending','appeal_complete','closed','withdrawn']).optional(),
  severity:             z.string().max(50).optional(),
  investigating_manager: z.string().max(200).optional(),
  investigation_start_date: dateSchema.nullable().optional(),
  investigation_end_date:   dateSchema.nullable().optional(),
  hearing_date:         dateSchema.nullable().optional(),
  hearing_panel:        z.string().max(500).nullable().optional(),
  outcome:              z.enum(['no_action','verbal_warning','first_written','final_written','dismissal','demotion','transfer']).nullable().optional(),
  outcome_date:         dateSchema.nullable().optional(),
  sanction_type:        z.string().max(100).nullable().optional(),
  sanction_expiry:      dateSchema.nullable().optional(),
  appeal_date:          dateSchema.nullable().optional(),
  appeal_outcome:       z.string().max(100).nullable().optional(),
  appeal_outcome_date:  dateSchema.nullable().optional(),
  acas_code_followed:   z.boolean().optional(),
  notes:                z.string().max(5000).nullable().optional(),
});

// ── Grievance Schemas ───────────────────────────────────────────────────────

const grievanceBodySchema = z.object({
  staff_id:             staffIdSchema,
  date_raised:          dateSchema,
  category:             z.enum(['bullying','harassment','discrimination','pay','working_conditions','management','health_safety','other']),
  description:          z.string().max(5000).nullable().optional(),
  status:               z.enum(['open','acknowledged','investigating','hearing_scheduled','outcome_issued','appeal_pending','appeal_complete','closed','withdrawn']).optional(),
  severity:             z.string().max(50).optional(),
  formal:               z.boolean().optional(),
  investigating_manager: z.string().max(200).optional(),
  meeting_date:         dateSchema.optional(),
  outcome:              z.enum(['upheld','partially_upheld','not_upheld']).optional(),
  outcome_date:         dateSchema.optional(),
  appeal_date:          dateSchema.optional(),
  appeal_outcome:       z.string().max(100).optional(),
  appeal_outcome_date:  dateSchema.optional(),
  acas_code_followed:   z.boolean().optional(),
  notes:                z.string().max(5000).nullable().optional(),
});

const grievanceUpdateSchema = z.object({
  date_raised:          dateSchema.optional(),
  category:             z.enum(['bullying','harassment','discrimination','pay','working_conditions','management','health_safety','other']).optional(),
  description:          z.string().max(5000).nullable().optional(),
  status:               z.enum(['open','acknowledged','investigating','hearing_scheduled','outcome_issued','appeal_pending','appeal_complete','closed','withdrawn']).optional(),
  severity:             z.string().max(50).optional(),
  formal:               z.boolean().optional(),
  investigating_manager: z.string().max(200).nullable().optional(),
  meeting_date:         dateSchema.nullable().optional(),
  outcome:              z.enum(['upheld','partially_upheld','not_upheld']).nullable().optional(),
  outcome_date:         dateSchema.nullable().optional(),
  appeal_date:          dateSchema.nullable().optional(),
  appeal_outcome:       z.string().max(100).nullable().optional(),
  appeal_outcome_date:  dateSchema.nullable().optional(),
  acas_code_followed:   z.boolean().optional(),
  notes:                z.string().max(5000).nullable().optional(),
});

const grievanceActionBodySchema = z.object({
  description:  z.string().min(1).max(2000),
  assigned_to:  z.string().max(200).optional(),
  due_date:     dateSchema.optional(),
  status:       z.string().max(50).optional(),
  notes:        z.string().max(2000).nullable().optional(),
});

const grievanceActionUpdateSchema = z.object({
  description:    z.string().min(1).max(2000).optional(),
  assigned_to:    z.string().max(200).nullable().optional(),
  due_date:       dateSchema.nullable().optional(),
  completed_date: dateSchema.nullable().optional(),
  status:         z.string().max(50).optional(),
  notes:          z.string().max(2000).nullable().optional(),
});

// ── Performance Schemas ─────────────────────────────────────────────────────

const performanceBodySchema = z.object({
  staff_id:         staffIdSchema,
  date_raised:      dateSchema,
  type:             z.enum(['capability','pip','probation_concern']),
  description:      z.string().max(5000).nullable().optional(),
  status:           z.enum(['open','informal','pip_active','pip_review','hearing_scheduled','outcome_issued','appeal_pending','closed']).optional(),
  objectives:       z.string().max(5000).nullable().optional(),
  support_plan:     z.string().max(5000).nullable().optional(),
  review_date:      dateSchema.optional(),
  review_outcome:   z.enum(['no_action','further_pip','redeployment','first_written','final_written','dismissal']).optional(),
  manager:          z.string().max(200).optional(),
  notes:            z.string().max(5000).nullable().optional(),
});

const performanceUpdateSchema = z.object({
  date_raised:      dateSchema.optional(),
  type:             z.enum(['capability','pip','probation_concern']).optional(),
  description:      z.string().max(5000).nullable().optional(),
  status:           z.enum(['open','informal','pip_active','pip_review','hearing_scheduled','outcome_issued','appeal_pending','closed']).optional(),
  objectives:       z.string().max(5000).nullable().optional(),
  support_plan:     z.string().max(5000).nullable().optional(),
  review_date:      dateSchema.nullable().optional(),
  review_outcome:   z.enum(['no_action','further_pip','redeployment','first_written','final_written','dismissal']).nullable().optional(),
  manager:          z.string().max(200).nullable().optional(),
  notes:            z.string().max(5000).nullable().optional(),
});

// ── RTW Interview Schemas ───────────────────────────────────────────────────

const rtwInterviewBodySchema = z.object({
  staff_id:           staffIdSchema,
  absence_start_date: dateSchema,
  rtw_date:           dateSchema,
  absence_end_date:   dateSchema.optional(),
  absence_reason:     z.string().max(200).optional(),
  conducted_by:       z.string().max(200).optional(),
  fit_for_work:       z.boolean().optional(),
  adjustments:        z.string().max(2000).nullable().optional(),
  referral_needed:    z.boolean().optional(),
  notes:              z.string().max(5000).nullable().optional(),
});

const rtwInterviewUpdateSchema = z.object({
  absence_start_date: dateSchema.optional(),
  absence_end_date:   dateSchema.nullable().optional(),
  rtw_date:           dateSchema.optional(),
  absence_reason:     z.string().max(200).nullable().optional(),
  conducted_by:       z.string().max(200).nullable().optional(),
  fit_for_work:       z.boolean().optional(),
  adjustments:        z.string().max(2000).nullable().optional(),
  referral_needed:    z.boolean().optional(),
  notes:              z.string().max(5000).nullable().optional(),
});

// ── OH Referral Schemas ─────────────────────────────────────────────────────

const ohReferralBodySchema = z.object({
  staff_id:         staffIdSchema,
  referral_date:    dateSchema,
  reason:           z.string().min(1).max(2000),
  status:           z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  provider:         z.string().max(200).optional(),
  appointment_date: dateSchema.optional(),
  report_received:  z.boolean().optional(),
  report_date:      dateSchema.optional(),
  recommendations:  z.string().max(5000).nullable().optional(),
  follow_up_date:   dateSchema.optional(),
  notes:            z.string().max(5000).nullable().optional(),
});

const ohReferralUpdateSchema = z.object({
  referral_date:    dateSchema.optional(),
  reason:           z.string().min(1).max(2000).optional(),
  status:           z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  provider:         z.string().max(200).nullable().optional(),
  appointment_date: dateSchema.nullable().optional(),
  report_received:  z.boolean().optional(),
  report_date:      dateSchema.nullable().optional(),
  recommendations:  z.string().max(5000).nullable().optional(),
  follow_up_date:   dateSchema.nullable().optional(),
  notes:            z.string().max(5000).nullable().optional(),
});

// ── Contract Schemas ────────────────────────────────────────────────────────

const contractBodySchema = z.object({
  staff_id:           staffIdSchema,
  contract_type:      z.enum(['permanent','fixed_term','bank','zero_hours','casual']),
  start_date:         dateSchema.optional(),
  end_date:           dateSchema.optional(),
  status:             z.enum(['active','probation','notice_period','terminated','suspended']).optional(),
  hours_per_week:     z.number().nonnegative().optional(),
  salary:             z.number().nonnegative().optional(),
  hourly_rate:        z.number().nonnegative().optional(),
  probation_end_date: dateSchema.optional(),
  notice_period_weeks: z.number().int().nonnegative().optional(),
  signed_date:        dateSchema.optional(),
  notes:              z.string().max(5000).nullable().optional(),
});

const contractUpdateSchema = z.object({
  contract_type:      z.enum(['permanent','fixed_term','bank','zero_hours','casual']).optional(),
  start_date:         dateSchema.nullable().optional(),
  end_date:           dateSchema.nullable().optional(),
  status:             z.enum(['active','probation','notice_period','terminated','suspended']).optional(),
  hours_per_week:     z.number().nonnegative().optional(),
  salary:             z.number().nonnegative().optional(),
  hourly_rate:        z.number().nonnegative().optional(),
  probation_end_date: dateSchema.nullable().optional(),
  notice_period_weeks: z.number().int().nonnegative().optional(),
  signed_date:        dateSchema.nullable().optional(),
  notes:              z.string().max(5000).nullable().optional(),
});

// ── Family Leave Schemas ────────────────────────────────────────────────────

const familyLeaveBodySchema = z.object({
  staff_id:           staffIdSchema,
  leave_type:         z.enum(['maternity','paternity','shared_parental','adoption','parental_unpaid','parental_bereavement','neonatal']),
  start_date:         dateSchema,
  end_date:           dateSchema.optional(),
  status:             z.enum(['requested','approved','active','kit_day','returned','cancelled']).optional(),
  expected_return:    dateSchema.optional(),
  actual_return:      dateSchema.optional(),
  kit_days_used:      z.number().int().nonnegative().optional(),
  pay_type:           z.enum(['SMP','SPP','ShPP','SAP','none']).optional(),
  notes:              z.string().max(5000).nullable().optional(),
});

const familyLeaveUpdateSchema = z.object({
  leave_type:         z.enum(['maternity','paternity','shared_parental','adoption','parental_unpaid','parental_bereavement','neonatal']).optional(),
  start_date:         dateSchema.optional(),
  end_date:           dateSchema.nullable().optional(),
  status:             z.enum(['requested','approved','active','kit_day','returned','cancelled']).optional(),
  expected_return:    dateSchema.nullable().optional(),
  actual_return:      dateSchema.nullable().optional(),
  kit_days_used:      z.number().int().nonnegative().optional(),
  pay_type:           z.enum(['SMP','SPP','ShPP','SAP','none']).nullable().optional(),
  notes:              z.string().max(5000).nullable().optional(),
});

// ── Flexible Working Schemas ────────────────────────────────────────────────

const flexWorkingBodySchema = z.object({
  staff_id:           staffIdSchema,
  request_date:       dateSchema,
  requested_change:   z.string().min(1).max(2000),
  decision_deadline:  dateSchema,
  status:             z.enum(['pending','meeting_scheduled','decided','implemented','appealed','withdrawn']).optional(),
  reason:             z.string().max(2000).nullable().optional(),
  current_pattern:    z.string().max(500).nullable().optional(),
  proposed_pattern:   z.string().max(500).nullable().optional(),
  decision:           z.string().max(100).optional(),
  decision_date:      dateSchema.optional(),
  decision_reason:    z.string().max(2000).nullable().optional(),
  trial_period_end:   dateSchema.optional(),
  appeal_date:        dateSchema.optional(),
  appeal_outcome:     z.string().max(100).optional(),
  notes:              z.string().max(5000).nullable().optional(),
});

const flexWorkingUpdateSchema = z.object({
  request_date:       dateSchema.optional(),
  requested_change:   z.string().min(1).max(2000).optional(),
  decision_deadline:  dateSchema.optional(),
  status:             z.enum(['pending','meeting_scheduled','decided','implemented','appealed','withdrawn']).optional(),
  reason:             z.string().max(2000).nullable().optional(),
  current_pattern:    z.string().max(500).nullable().optional(),
  proposed_pattern:   z.string().max(500).nullable().optional(),
  decision:           z.string().max(100).nullable().optional(),
  decision_date:      dateSchema.nullable().optional(),
  decision_reason:    z.string().max(2000).nullable().optional(),
  trial_period_end:   dateSchema.nullable().optional(),
  appeal_date:        dateSchema.nullable().optional(),
  appeal_outcome:     z.string().max(100).nullable().optional(),
  notes:              z.string().max(5000).nullable().optional(),
});

// ── EDI Schemas ─────────────────────────────────────────────────────────────

const ediBodySchema = z.object({
  record_type:    z.enum(['harassment_complaint','reasonable_adjustment']),
  staff_id:       staffIdSchema.optional(),
  date_recorded:  dateSchema.optional(),
  category:       z.string().max(100).optional(),
  data:           z.record(z.unknown()).optional(),
  notes:          z.string().max(5000).nullable().optional(),
});

const ediUpdateSchema = z.object({
  record_type:    z.enum(['harassment_complaint','reasonable_adjustment']).optional(),
  date_recorded:  dateSchema.nullable().optional(),
  category:       z.string().max(100).nullable().optional(),
  data:           z.record(z.unknown()).optional(),
  notes:          z.string().max(5000).nullable().optional(),
});

// ── TUPE Schemas ────────────────────────────────────────────────────────────

const tupeBodySchema = z.object({
  transfer_type:    z.string().min(1).max(100),
  transfer_date:    dateSchema,
  transferor_name:  z.string().min(1).max(200),
  transferee_name:  z.string().min(1).max(200),
  status:           z.enum(['planned','consultation','transferred','complete']).optional(),
  staff_affected:   z.number().int().nonnegative().optional(),
  consultation_start: dateSchema.optional(),
  consultation_end:   dateSchema.optional(),
  eli_sent_date:    dateSchema.optional(),
  measures_proposed: z.string().max(5000).nullable().optional(),
  notes:            z.string().max(5000).nullable().optional(),
});

const tupeUpdateSchema = z.object({
  transfer_type:    z.string().min(1).max(100).optional(),
  transfer_date:    dateSchema.optional(),
  transferor_name:  z.string().min(1).max(200).optional(),
  transferee_name:  z.string().min(1).max(200).optional(),
  status:           z.enum(['planned','consultation','transferred','complete']).optional(),
  staff_affected:   z.number().int().nonnegative().optional(),
  consultation_start: dateSchema.nullable().optional(),
  consultation_end:   dateSchema.nullable().optional(),
  eli_sent_date:    dateSchema.nullable().optional(),
  measures_proposed: z.string().max(5000).nullable().optional(),
  notes:            z.string().max(5000).nullable().optional(),
});

// ── Renewal Schemas ─────────────────────────────────────────────────────────

const renewalBodySchema = z.object({
  staff_id:       staffIdSchema,
  check_type:     z.enum(['dbs','rtw']),
  last_checked:   dateSchema.optional(),
  expiry_date:    dateSchema.optional(),
  status:         z.enum(['current','due_soon','overdue','pending','expired']).optional(),
  reference:      z.string().max(200).optional(),
  checked_by:     z.string().max(200).optional(),
  notes:          z.string().max(5000).nullable().optional(),
});

const renewalUpdateSchema = z.object({
  check_type:     z.enum(['dbs','rtw']).optional(),
  last_checked:   dateSchema.nullable().optional(),
  expiry_date:    dateSchema.nullable().optional(),
  status:         z.enum(['current','due_soon','overdue','pending','expired']).optional(),
  reference:      z.string().max(200).nullable().optional(),
  checked_by:     z.string().max(200).nullable().optional(),
  notes:          z.string().max(5000).nullable().optional(),
});

// ── Case Note Schemas ───────────────────────────────────────────────────────

const caseNoteBodySchema = z.object({
  note: z.string().min(1).max(5000),
});

// ── Helper ──────────────────────────────────────────────────────────────────

async function resolveHome(req, res) {
  const parsed = homeIdSchema.safeParse(req.query.home);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid home parameter' }); return null; }
  if (!parsed.data)    { res.status(400).json({ error: 'home parameter is required' }); return null; }
  const home = await homeRepo.findBySlug(parsed.data);
  if (!home) { res.status(404).json({ error: 'Home not found' }); return null; }
  return home;
}

// ── Staff List (for picker dropdown) ────────────────────────────────────────
router.get('/staff', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const staff = await staffRepo.findByHome(home.id);
    res.json(staff.map(s => ({ id: s.id, name: s.name, role: s.role, team: s.team, active: s.active })));
  } catch (err) { next(err); }
});

// ── Disciplinary Cases ──────────────────────────────────────────────────────

// GET /api/hr/cases/disciplinary?home=X&staff_id=&status=
router.get('/cases/disciplinary', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const filters = {};
    if (req.query.staff_id) filters.staffId = req.query.staff_id;
    if (req.query.status)   filters.status = req.query.status;
    res.json(await hrService.findDisciplinary(home.id, filters));
  } catch (err) { next(err); }
});

// POST /api/hr/cases/disciplinary?home=X
router.post('/cases/disciplinary', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = disciplinaryBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.createDisciplinary(home.id, {
      ...parsed.data,
      created_by: req.user.username,
    });
    await auditService.log('hr_disciplinary_create', home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/hr/cases/disciplinary/:id?home=X
router.get('/cases/disciplinary/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid case ID' });
    const result = await hrService.findDisciplinaryById(idP.data, home.id);
    if (!result) return res.status(404).json({ error: 'Disciplinary case not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/hr/cases/disciplinary/:id?home=X
router.put('/cases/disciplinary/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid case ID' });
    const parsed = disciplinaryUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.updateDisciplinary(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Disciplinary case not found' });
    await auditService.log('hr_disciplinary_update', home.slug, req.user.username, { id: result.id });
    res.json(result);
  } catch (err) { next(err); }
});

// ── Grievance Cases ─────────────────────────────────────────────────────────

// GET /api/hr/cases/grievance?home=X&staff_id=&status=
router.get('/cases/grievance', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const filters = {};
    if (req.query.staff_id) filters.staffId = req.query.staff_id;
    if (req.query.status)   filters.status = req.query.status;
    res.json(await hrService.findGrievance(home.id, filters));
  } catch (err) { next(err); }
});

// POST /api/hr/cases/grievance?home=X
router.post('/cases/grievance', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = grievanceBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.createGrievance(home.id, {
      ...parsed.data,
      created_by: req.user.username,
    });
    await auditService.log('hr_grievance_create', home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/hr/cases/grievance/:id?home=X
router.get('/cases/grievance/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid case ID' });
    const result = await hrService.findGrievanceById(idP.data, home.id);
    if (!result) return res.status(404).json({ error: 'Grievance case not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/hr/cases/grievance/:id?home=X
router.put('/cases/grievance/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid case ID' });
    const parsed = grievanceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.updateGrievance(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Grievance case not found' });
    await auditService.log('hr_grievance_update', home.slug, req.user.username, { id: result.id });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/hr/cases/grievance/:id/actions?home=X
router.get('/cases/grievance/:id/actions', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid case ID' });
    res.json(await hrService.findGrievanceActions(idP.data, home.id));
  } catch (err) { next(err); }
});

// POST /api/hr/cases/grievance/:id/actions?home=X
router.post('/cases/grievance/:id/actions', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid case ID' });
    const parsed = grievanceActionBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.createGrievanceAction(idP.data, home.id, parsed.data);
    await auditService.log('hr_grievance_create', home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PUT /api/hr/grievance-actions/:id?home=X
router.put('/grievance-actions/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid action ID' });
    const parsed = grievanceActionUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.updateGrievanceAction(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Grievance action not found' });
    await auditService.log('hr_grievance_update', home.slug, req.user.username, { id: result.id });
    res.json(result);
  } catch (err) { next(err); }
});

// ── Performance Cases ───────────────────────────────────────────────────────

// GET /api/hr/cases/performance?home=X&staff_id=&status=&type=
router.get('/cases/performance', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const filters = {};
    if (req.query.staff_id) filters.staffId = req.query.staff_id;
    if (req.query.status)   filters.status = req.query.status;
    if (req.query.type)     filters.type = req.query.type;
    res.json(await hrService.findPerformance(home.id, filters));
  } catch (err) { next(err); }
});

// POST /api/hr/cases/performance?home=X
router.post('/cases/performance', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = performanceBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.createPerformance(home.id, {
      ...parsed.data,
      created_by: req.user.username,
    });
    await auditService.log('hr_performance_create', home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/hr/cases/performance/:id?home=X
router.get('/cases/performance/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid case ID' });
    const result = await hrService.findPerformanceById(idP.data, home.id);
    if (!result) return res.status(404).json({ error: 'Performance case not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/hr/cases/performance/:id?home=X
router.put('/cases/performance/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid case ID' });
    const parsed = performanceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.updatePerformance(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Performance case not found' });
    await auditService.log('hr_performance_update', home.slug, req.user.username, { id: result.id });
    res.json(result);
  } catch (err) { next(err); }
});

// ── Absence ─────────────────────────────────────────────────────────────────

// GET /api/hr/absence/summary?home=X
router.get('/absence/summary', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    res.json(await hrService.calculateBradfordScores(home.id));
  } catch (err) { next(err); }
});

// GET /api/hr/absence/staff/:staffId?home=X
router.get('/absence/staff/:staffId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const staffIdP = staffIdSchema.safeParse(req.params.staffId);
    if (!staffIdP.success) return res.status(400).json({ error: 'Invalid staff ID' });
    res.json(await hrService.getAbsenceSummary(home.id, staffIdP.data));
  } catch (err) { next(err); }
});

// ── RTW Interviews ──────────────────────────────────────────────────────────

// GET /api/hr/rtw-interviews?home=X&staff_id=
router.get('/rtw-interviews', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const filters = {};
    if (req.query.staff_id) filters.staffId = req.query.staff_id;
    res.json(await hrService.findRtwInterviews(home.id, filters));
  } catch (err) { next(err); }
});

// POST /api/hr/rtw-interviews?home=X
router.post('/rtw-interviews', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = rtwInterviewBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.createRtwInterview(home.id, {
      ...parsed.data,
      created_by: req.user.username,
    });
    await auditService.log('hr_rtw_create', home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PUT /api/hr/rtw-interviews/:id
router.put('/rtw-interviews/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid interview ID' });
    const parsed = rtwInterviewUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.updateRtwInterview(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'RTW interview not found' });
    await auditService.log('hr_rtw_update', home.slug, req.user.username, { id: result.id });
    res.json(result);
  } catch (err) { next(err); }
});

// ── OH Referrals ────────────────────────────────────────────────────────────

// GET /api/hr/oh-referrals?home=X&staff_id=&status=
router.get('/oh-referrals', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const filters = {};
    if (req.query.staff_id) filters.staffId = req.query.staff_id;
    if (req.query.status)   filters.status = req.query.status;
    res.json(await hrService.findOhReferrals(home.id, filters));
  } catch (err) { next(err); }
});

// POST /api/hr/oh-referrals?home=X
router.post('/oh-referrals', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = ohReferralBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.createOhReferral(home.id, {
      ...parsed.data,
      created_by: req.user.username,
    });
    await auditService.log('hr_oh_referral_create', home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PUT /api/hr/oh-referrals/:id
router.put('/oh-referrals/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid referral ID' });
    const parsed = ohReferralUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.updateOhReferral(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'OH referral not found' });
    await auditService.log('hr_oh_referral_update', home.slug, req.user.username, { id: result.id });
    res.json(result);
  } catch (err) { next(err); }
});

// ── Contracts ───────────────────────────────────────────────────────────────

// GET /api/hr/contracts?home=X&staff_id=&status=
router.get('/contracts', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const filters = {};
    if (req.query.staff_id) filters.staffId = req.query.staff_id;
    if (req.query.status)   filters.status = req.query.status;
    res.json(await hrService.findContracts(home.id, filters));
  } catch (err) { next(err); }
});

// POST /api/hr/contracts?home=X
router.post('/contracts', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = contractBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.createContract(home.id, {
      ...parsed.data,
      created_by: req.user.username,
    });
    await auditService.log('hr_contract_create', home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/hr/contracts/:id?home=X
router.get('/contracts/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid contract ID' });
    const result = await hrService.findContractById(idP.data, home.id);
    if (!result) return res.status(404).json({ error: 'Contract not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/hr/contracts/:id?home=X
router.put('/contracts/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid contract ID' });
    const parsed = contractUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.updateContract(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Contract not found' });
    await auditService.log('hr_contract_update', home.slug, req.user.username, { id: result.id });
    res.json(result);
  } catch (err) { next(err); }
});

// ── Family Leave ────────────────────────────────────────────────────────────

// GET /api/hr/family-leave?home=X&staff_id=&type=
router.get('/family-leave', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const filters = {};
    if (req.query.staff_id) filters.staffId = req.query.staff_id;
    if (req.query.type)     filters.type = req.query.type;
    res.json(await hrService.findFamilyLeave(home.id, filters));
  } catch (err) { next(err); }
});

// POST /api/hr/family-leave?home=X
router.post('/family-leave', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = familyLeaveBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.createFamilyLeave(home.id, {
      ...parsed.data,
      created_by: req.user.username,
    });
    await auditService.log('hr_family_leave_create', home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/hr/family-leave/:id?home=X
router.get('/family-leave/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid family leave ID' });
    const result = await hrService.findFamilyLeaveById(idP.data, home.id);
    if (!result) return res.status(404).json({ error: 'Family leave record not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/hr/family-leave/:id?home=X
router.put('/family-leave/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid family leave ID' });
    const parsed = familyLeaveUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.updateFamilyLeave(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Family leave record not found' });
    await auditService.log('hr_family_leave_update', home.slug, req.user.username, { id: result.id });
    res.json(result);
  } catch (err) { next(err); }
});

// ── Flexible Working ────────────────────────────────────────────────────────

// GET /api/hr/flexible-working?home=X&staff_id=&status=
router.get('/flexible-working', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const filters = {};
    if (req.query.staff_id) filters.staffId = req.query.staff_id;
    if (req.query.status)   filters.status = req.query.status;
    res.json(await hrService.findFlexWorking(home.id, filters));
  } catch (err) { next(err); }
});

// POST /api/hr/flexible-working?home=X
router.post('/flexible-working', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = flexWorkingBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.createFlexWorking(home.id, {
      ...parsed.data,
      created_by: req.user.username,
    });
    await auditService.log('hr_flex_working_create', home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/hr/flexible-working/:id?home=X
router.get('/flexible-working/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid request ID' });
    const result = await hrService.findFlexWorkingById(idP.data, home.id);
    if (!result) return res.status(404).json({ error: 'Flexible working request not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/hr/flexible-working/:id?home=X
router.put('/flexible-working/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid request ID' });
    const parsed = flexWorkingUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.updateFlexWorking(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Flexible working request not found' });
    await auditService.log('hr_flex_working_update', home.slug, req.user.username, { id: result.id });
    res.json(result);
  } catch (err) { next(err); }
});

// ── EDI ─────────────────────────────────────────────────────────────────────

// GET /api/hr/edi?home=X&record_type=&staff_id=
router.get('/edi', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const filters = {};
    if (req.query.record_type) filters.recordType = req.query.record_type;
    if (req.query.staff_id)    filters.staffId = req.query.staff_id;
    res.json(await hrService.findEdi(home.id, filters));
  } catch (err) { next(err); }
});

// POST /api/hr/edi?home=X
router.post('/edi', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = ediBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.createEdi(home.id, {
      ...parsed.data,
      created_by: req.user.username,
    });
    await auditService.log('hr_edi_create', home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/hr/edi/:id?home=X
router.get('/edi/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid EDI record ID' });
    const result = await hrService.findEdiById(idP.data, home.id);
    if (!result) return res.status(404).json({ error: 'EDI record not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/hr/edi/:id?home=X
router.put('/edi/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid EDI record ID' });
    const parsed = ediUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.updateEdi(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'EDI record not found' });
    await auditService.log('hr_edi_update', home.slug, req.user.username, { id: result.id });
    res.json(result);
  } catch (err) { next(err); }
});

// ── TUPE ────────────────────────────────────────────────────────────────────

// GET /api/hr/tupe?home=X
router.get('/tupe', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    res.json(await hrService.findTupe(home.id));
  } catch (err) { next(err); }
});

// POST /api/hr/tupe?home=X
router.post('/tupe', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = tupeBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.createTupe(home.id, {
      ...parsed.data,
      created_by: req.user.username,
    });
    await auditService.log('hr_tupe_create', home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/hr/tupe/:id?home=X
router.get('/tupe/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid TUPE record ID' });
    const result = await hrService.findTupeById(idP.data, home.id);
    if (!result) return res.status(404).json({ error: 'TUPE record not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/hr/tupe/:id?home=X
router.put('/tupe/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid TUPE record ID' });
    const parsed = tupeUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.updateTupe(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'TUPE record not found' });
    await auditService.log('hr_tupe_update', home.slug, req.user.username, { id: result.id });
    res.json(result);
  } catch (err) { next(err); }
});

// ── Renewals (RTW/DBS) ─────────────────────────────────────────────────────

// GET /api/hr/renewals?home=X&staff_id=&check_type=&status=
router.get('/renewals', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const filters = {};
    if (req.query.staff_id)    filters.staffId = req.query.staff_id;
    if (req.query.check_type)  filters.checkType = req.query.check_type;
    if (req.query.status)      filters.status = req.query.status;
    res.json(await hrService.findRenewals(home.id, filters));
  } catch (err) { next(err); }
});

// POST /api/hr/renewals?home=X
router.post('/renewals', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = renewalBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.createRenewal(home.id, {
      ...parsed.data,
      created_by: req.user.username,
    });
    await auditService.log('hr_dbs_renewal_create', home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /api/hr/renewals/:id?home=X
router.get('/renewals/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid renewal ID' });
    const result = await hrService.findRenewalById(idP.data, home.id);
    if (!result) return res.status(404).json({ error: 'Renewal record not found' });
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/hr/renewals/:id?home=X
router.put('/renewals/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid renewal ID' });
    const parsed = renewalUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.updateRenewal(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Renewal record not found' });
    await auditService.log('hr_dbs_renewal_update', home.slug, req.user.username, { id: result.id });
    res.json(result);
  } catch (err) { next(err); }
});

// ── Cross-cutting: Warnings & Stats ─────────────────────────────────────────

// GET /api/hr/warnings?home=X
router.get('/warnings', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    res.json(await hrService.getActiveWarnings(home.id));
  } catch (err) { next(err); }
});

// GET /api/hr/stats?home=X
router.get('/stats', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    res.json(await hrService.getHrStats(home.id));
  } catch (err) { next(err); }
});

// ── Case Notes ──────────────────────────────────────────────────────────────

// GET /api/hr/case-notes/:caseType/:caseId?home=X
router.get('/case-notes/:caseType/:caseId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const caseTypeP = caseTypeSchema.safeParse(req.params.caseType);
    if (!caseTypeP.success) return res.status(400).json({ error: 'Invalid case type' });
    const caseIdP = idSchema.safeParse(req.params.caseId);
    if (!caseIdP.success) return res.status(400).json({ error: 'Invalid case ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    res.json(await hrService.findCaseNotes(home.id, caseTypeP.data, caseIdP.data));
  } catch (err) { next(err); }
});

// POST /api/hr/case-notes/:caseType/:caseId?home=X
router.post('/case-notes/:caseType/:caseId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const caseTypeP = caseTypeSchema.safeParse(req.params.caseType);
    if (!caseTypeP.success) return res.status(400).json({ error: 'Invalid case type' });
    const caseIdP = idSchema.safeParse(req.params.caseId);
    if (!caseIdP.success) return res.status(400).json({ error: 'Invalid case ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = caseNoteBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const result = await hrService.createCaseNote(home.id, caseTypeP.data, caseIdP.data, {
      author: req.user.username,
      content: parsed.data.note,
    });
    await auditService.log('hr_case_note_create', home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// ── File Attachments ────────────────────────────────────────────────────────

// GET /api/hr/attachments/:caseType/:caseId?home=X
router.get('/attachments/:caseType/:caseId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = caseTypeSchema.safeParse(req.params.caseType);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid case type' });
    const caseId = Number(req.params.caseId);
    if (!Number.isInteger(caseId) || caseId < 1) return res.status(400).json({ error: 'Invalid case ID' });
    const files = await hrService.findAttachments(parsed.data, caseId, home.id);
    res.json(files);
  } catch (err) { next(err); }
});

// POST /api/hr/attachments/:caseType/:caseId?home=X
router.post('/attachments/:caseType/:caseId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    // Validate home and caseType BEFORE multer writes any bytes to disk
    const home = await resolveHome(req, res);
    if (!home) return;
    const caseTypeParsed = caseTypeSchema.safeParse(req.params.caseType);
    if (!caseTypeParsed.success) return res.status(400).json({ error: 'Invalid case type' });
    const caseId = Number(req.params.caseId);
    if (!Number.isInteger(caseId) || caseId < 1) return res.status(400).json({ error: 'Invalid case ID' });
    req._homeId = home.id;
    upload.single('file')(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 20MB)' });
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      try {
        const attachment = await hrService.createAttachment(home.id, caseTypeParsed.data, caseId, {
          original_name: req.file.originalname,
          stored_name: req.file.filename,
          mime_type: req.file.mimetype,
          size_bytes: req.file.size,
          description: req.body.description || null,
          uploaded_by: req.user.username,
        });
        await auditService.log('hr_attachment_upload', home.slug, req.user.username, { id: attachment.id });
        res.status(201).json(attachment);
      } catch (e) { next(e); }
    });
  } catch (err) { next(err); }
});

// GET /api/hr/attachments/download/:id?home=X
router.get('/attachments/download/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid attachment ID' });
    const att = await hrService.findAttachmentById(id, home.id);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    const filePath = path.join(config.upload.dir, String(home.id), att.case_type, String(att.case_id), att.stored_name);
    res.setHeader('Content-Type', att.mime_type);
    const safeName = att.original_name.replace(/["\r\n;]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', att.size_bytes);
    createReadStream(filePath).pipe(res);
  } catch (err) { next(err); }
});

// DELETE /api/hr/attachments/:id?home=X
router.delete('/attachments/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid attachment ID' });
    const att = await hrService.deleteAttachment(id, home.id);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    // Delete file from disk (best effort)
    const filePath = path.join(config.upload.dir, String(home.id), att.case_type, String(att.case_id), att.stored_name);
    await unlink(filePath).catch(() => {});
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ── Investigation Meetings ──────────────────────────────────────────────────

const meetingBodySchema = z.object({
  meeting_date:  dateSchema,
  meeting_time:  z.string().max(10).optional(),
  meeting_type:  z.enum(['interview', 'hearing', 'review', 'informal']).optional(),
  location:      z.string().max(200).optional(),
  attendees:     z.array(z.object({
    staff_id: z.string().max(20).optional(),
    name: z.string().max(200),
    role_in_meeting: z.enum(['subject', 'investigator', 'witness', 'companion', 'note_taker', 'hr_advisor', 'chair']),
  })).optional(),
  summary:       z.string().max(10000).optional(),
  key_points:    z.string().max(10000).optional(),
  outcome:       z.string().max(5000).optional(),
});

const meetingCaseTypeSchema = z.enum(['disciplinary', 'grievance', 'performance']);

// GET /api/hr/meetings/:caseType/:caseId?home=X
router.get('/meetings/:caseType/:caseId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = meetingCaseTypeSchema.safeParse(req.params.caseType);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid case type' });
    const caseId = Number(req.params.caseId);
    if (!Number.isInteger(caseId) || caseId < 1) return res.status(400).json({ error: 'Invalid case ID' });
    const meetings = await hrService.findMeetings(parsed.data, caseId, home.id);
    res.json(meetings);
  } catch (err) { next(err); }
});

// POST /api/hr/meetings/:caseType/:caseId?home=X
router.post('/meetings/:caseType/:caseId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const ctParsed = meetingCaseTypeSchema.safeParse(req.params.caseType);
    if (!ctParsed.success) return res.status(400).json({ error: 'Invalid case type' });
    const caseId = Number(req.params.caseId);
    if (!Number.isInteger(caseId) || caseId < 1) return res.status(400).json({ error: 'Invalid case ID' });
    const parsed = meetingBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const meeting = await hrService.createMeeting(home.id, ctParsed.data, caseId, {
      ...parsed.data,
      recorded_by: req.user.username,
    });
    await auditService.log(`hr_${ctParsed.data}_create`, home.slug, req.user.username, { id: meeting.id });
    res.status(201).json(meeting);
  } catch (err) { next(err); }
});

// PUT /api/hr/meetings/:id?home=X
router.put('/meetings/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid meeting ID' });
    const parsed = meetingBodySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const meeting = await hrService.updateMeeting(id, home.id, parsed.data);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    await auditService.log('hr_disciplinary_update', home.slug, req.user.username, { id: meeting.id });
    res.json(meeting);
  } catch (err) { next(err); }
});

export default router;
