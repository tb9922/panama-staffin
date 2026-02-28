import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { createReadStream, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { fileTypeFromFile } from 'file-type';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { config } from '../config.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as hrService from '../services/hrService.js';
import * as hrRepo from '../repositories/hrRepo.js';
import * as auditService from '../services/auditService.js';
import { pool } from '../db.js';
import {
  mapDisciplinaryFields, mapGrievanceFields, mapPerformanceFields,
  mapRtwFields, mapOhFields, mapContractFields, mapFamilyLeaveFields,
  mapFlexFields, mapEdiFields, mapTupeFields, mapRenewalFields,
  diffFields,
} from '../lib/hrFieldMappers.js';

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
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const staffIdSchema = z.string().min(1).max(20);
const caseTypeSchema = z.enum([
  'disciplinary', 'grievance', 'performance', 'rtw_interview',
  'oh_referral', 'contract', 'family_leave', 'flexible_working',
  'edi', 'tupe', 'renewal',
]);

// ── Query filter helpers ──────────────────────────────────────────────────
}

// ── Disciplinary Schemas ────────────────────────────────────────────────────

const jsonOrArray = z.preprocess(
  v => { if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } } return v; },
  z.array(z.object({}).passthrough())
);

const disciplinaryBodySchema = z.object({
  staff_id:             staffIdSchema,
  date_raised:          dateSchema,
  category:             z.enum(['misconduct','gross_misconduct','capability','attendance','conduct','other']),
  allegation_summary:   z.string().min(1).max(5000),
  allegation_detail:    z.string().max(10000).nullable().optional(),
  raised_by:            z.string().min(1).max(200),
  source:               z.enum(['incident','complaint','observation','whistleblowing','other']).default('other'),
  source_ref:           z.string().max(200).nullable().optional(),
  status:               z.enum(['open','investigation','hearing_scheduled','outcome_issued','appeal_pending','appeal_complete','closed','withdrawn']).optional(),
});

const disciplinaryUpdateSchema = z.object({
  // Core
  date_raised:          dateSchema.optional(),
  raised_by:            z.string().max(200).optional(),
  source:               z.enum(['incident','complaint','observation','whistleblowing','other']).optional(),
  source_ref:           z.string().max(200).nullable().optional(),
  category:             z.enum(['misconduct','gross_misconduct','capability','attendance','conduct','other']).optional(),
  allegation_summary:   z.string().min(1).max(5000).optional(),
  allegation_detail:    z.string().max(10000).nullable().optional(),
  // Investigation
  investigation_status: z.enum(['not_started','in_progress','complete']).optional(),
  investigation_officer: z.string().max(200).nullable().optional(),
  investigation_start_date: dateSchema.nullable().optional(),
  investigation_notes:  z.string().max(5000).nullable().optional(),
  witnesses:            jsonOrArray.optional(),
  evidence_items:       jsonOrArray.optional(),
  investigation_completed_date: dateSchema.nullable().optional(),
  investigation_findings: z.string().max(5000).nullable().optional(),
  investigation_recommendation: z.enum(['no_action','informal_warning','formal_hearing','refer_police','refer_safeguarding']).nullable().optional(),
  // Suspension
  suspended:            z.boolean().optional(),
  suspension_date:      dateSchema.nullable().optional(),
  suspension_reason:    z.string().max(2000).nullable().optional(),
  suspension_review_date: dateSchema.nullable().optional(),
  suspension_end_date:  dateSchema.nullable().optional(),
  suspension_on_full_pay: z.boolean().optional(),
  // Hearing
  hearing_status:       z.enum(['not_scheduled','scheduled','held','adjourned','cancelled']).optional(),
  hearing_date:         dateSchema.nullable().optional(),
  hearing_time:         z.string().max(10).nullable().optional(),
  hearing_location:     z.string().max(200).nullable().optional(),
  hearing_chair:        z.string().max(200).nullable().optional(),
  hearing_letter_sent_date: dateSchema.nullable().optional(),
  hearing_companion_name: z.string().max(200).nullable().optional(),
  hearing_companion_role: z.enum(['colleague','trade_union_rep']).nullable().optional(),
  hearing_notes:        z.string().max(5000).nullable().optional(),
  hearing_employee_response: z.string().max(5000).nullable().optional(),
  // Outcome
  outcome:              z.enum(['no_action','verbal_warning','first_written','final_written','dismissal','demotion','transfer']).nullable().optional(),
  outcome_date:         dateSchema.nullable().optional(),
  outcome_reason:       z.string().max(5000).nullable().optional(),
  outcome_notes:        z.string().max(5000).nullable().optional(),  // Frontend alias → outcome_reason
  outcome_letter_sent_date: dateSchema.nullable().optional(),
  outcome_letter_method: z.enum(['hand_delivered','recorded_post','email']).nullable().optional(),
  warning_expiry_date:  dateSchema.nullable().optional(),
  // Dismissal
  notice_period_start:  dateSchema.nullable().optional(),
  notice_period_end:    dateSchema.nullable().optional(),
  pay_in_lieu_of_notice: z.boolean().nullable().optional(),
  dismissal_effective_date: dateSchema.nullable().optional(),
  // Appeal
  appeal_status:        z.enum(['none','requested','scheduled','held','decided']).optional(),
  appeal_received_date: dateSchema.nullable().optional(),
  appeal_date:          dateSchema.nullable().optional(),  // Frontend alias → appeal_received_date
  appeal_deadline:      dateSchema.nullable().optional(),
  appeal_grounds:       z.string().max(5000).nullable().optional(),
  appeal_hearing_date:  dateSchema.nullable().optional(),
  appeal_hearing_chair: z.string().max(200).nullable().optional(),
  appeal_hearing_companion_name: z.string().max(200).nullable().optional(),
  appeal_outcome:       z.enum(['upheld','partially_upheld','overturned']).nullable().optional(),
  appeal_outcome_date:  dateSchema.nullable().optional(),
  appeal_outcome_reason: z.string().max(5000).nullable().optional(),
  appeal_outcome_letter_sent_date: dateSchema.nullable().optional(),
  // Linked
  linked_grievance_id:  z.number().int().nullable().optional(),
  disciplinary_paused_for_grievance: z.boolean().optional(),
  // Meta
  status:               z.enum(['open','investigation','hearing_scheduled','outcome_issued','appeal_pending','appeal_complete','closed','withdrawn']).optional(),
  closed_date:          dateSchema.nullable().optional(),
  closed_reason:        z.enum(['resolved','warning_expired','appeal_overturned','employee_left','withdrawn']).nullable().optional(),
});

// ── Grievance Schemas ───────────────────────────────────────────────────────

const grievanceBodySchema = z.object({
  staff_id:             staffIdSchema,
  date_raised:          dateSchema,
  raised_by_method:     z.enum(['verbal','written','email']).default('written'),
  category:             z.enum(['bullying','harassment','discrimination','pay','working_conditions','management','health_safety','other']),
  protected_characteristic: z.enum(['age','disability','gender_reassignment','marriage','pregnancy','race','religion','sex','sexual_orientation']).nullable().optional(),
  description:          z.string().min(1).max(5000),
  subject_detail:       z.string().max(5000).nullable().optional(),
  desired_outcome:      z.string().max(5000).nullable().optional(),
  confidential:         z.boolean().default(false),
  status:               z.enum(['open','acknowledged','investigating','hearing_scheduled','outcome_issued','appeal_pending','appeal_complete','closed','withdrawn']).optional(),
  notes:                z.string().max(5000).nullable().optional(),
});

const grievanceUpdateSchema = z.object({
  // Submission
  date_raised:          dateSchema.optional(),
  raised_by_method:     z.enum(['verbal','written','email']).optional(),
  category:             z.enum(['bullying','harassment','discrimination','pay','working_conditions','management','health_safety','other']).optional(),
  protected_characteristic: z.enum(['age','disability','gender_reassignment','marriage','pregnancy','race','religion','sex','sexual_orientation']).nullable().optional(),
  description:          z.string().max(5000).nullable().optional(),
  subject_detail:       z.string().max(5000).nullable().optional(),
  desired_outcome:      z.string().max(5000).nullable().optional(),
  // Acknowledgement
  acknowledged_date:    dateSchema.nullable().optional(),
  acknowledge_deadline: dateSchema.nullable().optional(),
  acknowledged_by:      z.string().max(200).nullable().optional(),
  // Investigation
  investigation_status: z.enum(['not_started','in_progress','complete']).optional(),
  investigation_officer: z.string().max(200).nullable().optional(),
  investigation_start_date: dateSchema.nullable().optional(),
  investigation_notes:  z.string().max(5000).nullable().optional(),
  witnesses:            z.array(z.object({ name: z.string().max(200).optional(), role: z.string().max(200).optional(), statement_summary: z.string().max(5000).optional() }).passthrough()).optional(),
  evidence_items:       z.array(z.object({ description: z.string().max(5000).optional(), date: dateSchema.optional(), type: z.string().max(100).optional() }).passthrough()).optional(),
  investigation_completed_date: dateSchema.nullable().optional(),
  investigation_findings: z.string().max(5000).nullable().optional(),
  // Hearing
  hearing_status:       z.enum(['not_scheduled','scheduled','held','adjourned','cancelled']).optional(),
  hearing_date:         dateSchema.nullable().optional(),
  hearing_time:         z.string().max(10).nullable().optional(),
  hearing_location:     z.string().max(200).nullable().optional(),
  hearing_chair:        z.string().max(200).nullable().optional(),
  hearing_letter_sent_date: dateSchema.nullable().optional(),
  hearing_companion_name: z.string().max(200).nullable().optional(),
  hearing_companion_role: z.enum(['colleague','trade_union_rep']).nullable().optional(),
  hearing_notes:        z.string().max(5000).nullable().optional(),
  employee_statement_at_hearing: z.string().max(5000).nullable().optional(),
  // Outcome
  outcome:              z.enum(['upheld','partially_upheld','not_upheld']).nullable().optional(),
  outcome_date:         dateSchema.nullable().optional(),
  outcome_reason:       z.string().max(5000).nullable().optional(),
  outcome_letter_sent_date: dateSchema.nullable().optional(),
  mediation_offered:    z.boolean().optional(),
  mediation_accepted:   z.boolean().optional(),
  mediator_name:        z.string().max(200).nullable().optional(),
  // Appeal
  appeal_status:        z.enum(['none','requested','scheduled','held','decided']).optional(),
  appeal_received_date: dateSchema.nullable().optional(),
  appeal_deadline:      dateSchema.nullable().optional(),
  appeal_grounds:       z.string().max(5000).nullable().optional(),
  appeal_hearing_date:  dateSchema.nullable().optional(),
  appeal_hearing_chair: z.string().max(200).nullable().optional(),
  appeal_outcome:       z.enum(['upheld','partially_upheld','overturned']).nullable().optional(),
  appeal_outcome_date:  dateSchema.nullable().optional(),
  appeal_outcome_reason: z.string().max(5000).nullable().optional(),
  appeal_outcome_letter_sent_date: dateSchema.nullable().optional(),
  // Linked
  linked_disciplinary_id: z.number().int().nullable().optional(),
  triggers_disciplinary: z.boolean().optional(),
  // Meta
  status:               z.enum(['open','acknowledged','investigating','hearing_scheduled','outcome_issued','appeal_pending','appeal_complete','closed','withdrawn']).optional(),
  confidential:         z.boolean().optional(),
  closed_date:          dateSchema.nullable().optional(),
  closed_reason:        z.string().max(50).nullable().optional(),
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
  raised_by:        z.string().min(1).max(200),
  type:             z.enum(['capability','pip','probation_concern']),
  description:      z.string().max(5000).nullable().optional(),  // Frontend alias → concern_summary
  concern_summary:  z.string().max(5000).nullable().optional(),
  concern_detail:   z.string().max(10000).nullable().optional(),
  performance_area: z.enum(['clinical_competence','communication','attendance','teamwork','documentation','compliance','other']),
  manager:          z.string().max(200).optional(),  // Ghost — ignored
  status:           z.enum(['open','informal','pip_active','pip_review','hearing_scheduled','outcome_issued','appeal_pending','closed']).optional(),
});

const performanceUpdateSchema = z.object({
  // Core
  date_raised:      dateSchema.optional(),
  type:             z.enum(['capability','pip','probation_concern']).optional(),
  description:      z.string().max(5000).nullable().optional(),  // Frontend alias → concern_summary
  concern_summary:  z.string().max(5000).nullable().optional(),
  concern_detail:   z.string().max(10000).nullable().optional(),
  performance_area: z.string().max(200).nullable().optional(),
  manager:          z.string().max(200).nullable().optional(),   // Ghost — ignored
  // Informal
  informal_discussion_date: dateSchema.nullable().optional(),
  informal_discussion_notes: z.string().max(5000).nullable().optional(),
  informal_notes:   z.string().max(5000).nullable().optional(),  // Frontend alias → informal_discussion_notes
  informal_targets: z.union([z.array(z.object({}).passthrough()), z.string().max(10000)]).nullable().optional(),
  informal_review_date: dateSchema.nullable().optional(),
  informal_outcome: z.string().max(500).nullable().optional(),
  // PIP
  pip_start_date:   dateSchema.nullable().optional(),
  pip_end_date:     dateSchema.nullable().optional(),
  pip_objectives:   z.union([z.array(z.object({}).passthrough()), z.string().max(10000)]).nullable().optional(),
  pip_overall_outcome: z.string().max(500).nullable().optional(),
  pip_extended_to:  dateSchema.nullable().optional(),
  pip_review_dates: z.string().max(2000).nullable().optional(),  // Ghost — ignored
  // Hearing
  hearing_status:   z.enum(['not_scheduled','scheduled','held','adjourned','cancelled']).optional(),
  hearing_date:     dateSchema.nullable().optional(),
  hearing_time:     z.string().max(10).nullable().optional(),
  hearing_location: z.string().max(200).nullable().optional(),
  hearing_chair:    z.string().max(200).nullable().optional(),
  hearing_letter_sent_date: dateSchema.nullable().optional(),
  hearing_companion_name: z.string().max(200).nullable().optional(),
  hearing_companion_role: z.enum(['colleague','trade_union_rep']).nullable().optional(),
  hearing_notes:    z.string().max(5000).nullable().optional(),
  // Outcome
  outcome:          z.string().max(200).nullable().optional(),
  outcome_date:     dateSchema.nullable().optional(),
  outcome_reason:   z.string().max(5000).nullable().optional(),
  outcome_letter_sent_date: dateSchema.nullable().optional(),
  warning_expiry_date: dateSchema.nullable().optional(),
  // Redeployment
  redeployment_offered: z.boolean().optional(),
  redeployment_role: z.string().max(200).nullable().optional(),
  redeployment_accepted: z.boolean().optional(),
  // Appeal
  appeal_status:    z.enum(['none','requested','scheduled','held','decided']).optional(),
  appeal_received_date: dateSchema.nullable().optional(),
  appeal_date:      dateSchema.nullable().optional(),  // Frontend alias → appeal_received_date
  appeal_deadline:  dateSchema.nullable().optional(),
  appeal_grounds:   z.string().max(5000).nullable().optional(),
  appeal_hearing_date: dateSchema.nullable().optional(),
  appeal_outcome:   z.string().max(200).nullable().optional(),
  appeal_outcome_date: dateSchema.nullable().optional(),
  appeal_outcome_reason: z.string().max(5000).nullable().optional(),
  // Meta
  status:           z.enum(['open','informal','pip_active','pip_review','hearing_scheduled','outcome_issued','appeal_pending','closed']).optional(),
  closed_date:      dateSchema.nullable().optional(),
});

// ── RTW Interview Schemas ───────────────────────────────────────────────────

const rtwInterviewBodySchema = z.object({
  staff_id:           staffIdSchema,
  absence_start_date: dateSchema,
  rtw_date:           dateSchema,
  absence_end_date:   dateSchema.optional(),
  absence_reason:     z.string().max(200).optional(),
  conducted_by:       z.string().min(1).max(200),
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
  referred_by:      z.string().min(1).max(200),
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
  record_type:          z.enum(['harassment_complaint','reasonable_adjustment']),
  staff_id:             staffIdSchema.optional(),
  date_recorded:        dateSchema.optional(),        // Frontend alias → complaint_date
  complaint_date:       dateSchema.optional(),
  category:             z.string().max(100).optional(),  // Frontend alias → harassment_category
  harassment_category:  z.string().max(100).optional(),
  // Harassment fields
  third_party:          z.boolean().optional(),
  third_party_type:     z.string().max(100).nullable().optional(),
  respondent_type:      z.string().max(100).nullable().optional(),
  respondent_staff_id:  z.string().max(20).nullable().optional(),
  respondent_name:      z.string().max(200).nullable().optional(),
  respondent_role:      z.string().max(100).nullable().optional(),  // Frontend alias → respondent_type
  handling_route:       z.string().max(100).nullable().optional(),
  linked_case_id:       z.number().int().nullable().optional(),
  reasonable_steps_evidence: z.string().max(5000).nullable().optional(),
  // Reasonable adjustment fields
  condition_description: z.string().max(5000).nullable().optional(),
  adjustments:          z.string().max(5000).nullable().optional(),
  oh_referral_id:       z.number().int().nullable().optional(),
  access_to_work_applied: z.boolean().optional(),
  access_to_work_reference: z.string().max(200).nullable().optional(),
  access_to_work_amount: z.number().nullable().optional(),
  // Common
  description:          z.string().max(5000).nullable().optional(),
  status:               z.string().max(50).nullable().optional(),
  outcome:              z.string().max(5000).nullable().optional(),
  notes:                z.string().max(5000).nullable().optional(),
});

const ediUpdateSchema = z.object({
  record_type:          z.enum(['harassment_complaint','reasonable_adjustment']).optional(),
  date_recorded:        dateSchema.nullable().optional(),
  complaint_date:       dateSchema.nullable().optional(),
  category:             z.string().max(100).nullable().optional(),
  harassment_category:  z.string().max(100).nullable().optional(),
  third_party:          z.boolean().optional(),
  third_party_type:     z.string().max(100).nullable().optional(),
  respondent_type:      z.string().max(100).nullable().optional(),
  respondent_staff_id:  z.string().max(20).nullable().optional(),
  respondent_name:      z.string().max(200).nullable().optional(),
  respondent_role:      z.string().max(100).nullable().optional(),
  handling_route:       z.string().max(100).nullable().optional(),
  linked_case_id:       z.number().int().nullable().optional(),
  reasonable_steps_evidence: z.string().max(5000).nullable().optional(),
  condition_description: z.string().max(5000).nullable().optional(),
  adjustments:          z.string().max(5000).nullable().optional(),
  oh_referral_id:       z.number().int().nullable().optional(),
  access_to_work_applied: z.boolean().optional(),
  access_to_work_reference: z.string().max(200).nullable().optional(),
  access_to_work_amount: z.number().nullable().optional(),
  description:          z.string().max(5000).nullable().optional(),
  status:               z.string().max(50).nullable().optional(),
  outcome:              z.string().max(5000).nullable().optional(),
  notes:                z.string().max(5000).nullable().optional(),
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
  staff_id:             staffIdSchema,
  check_type:           z.enum(['dbs','rtw']),
  last_checked:         dateSchema.optional(),           // Frontend alias → dbs_check_date / rtw_check_date
  expiry_date:          dateSchema.optional(),           // Frontend alias → dbs_next_renewal_due / rtw_document_expiry
  reference:            z.string().max(200).optional(),  // Frontend alias → dbs_certificate_number
  certificate_number:   z.string().max(200).optional(),  // Frontend → dbs_certificate_number
  document_type:        z.string().max(100).optional(),  // Frontend → rtw_document_type
  status:               z.enum(['current','due_soon','overdue','pending','expired']).optional(),
  checked_by:           z.string().max(200).optional(),
  notes:                z.string().max(5000).nullable().optional(),
  // DB column names (also accepted directly)
  dbs_certificate_number: z.string().max(200).nullable().optional(),
  dbs_disclosure_level: z.string().max(50).nullable().optional(),
  dbs_check_date:       dateSchema.optional(),
  dbs_next_renewal_due: dateSchema.optional(),
  dbs_update_service_registered: z.boolean().optional(),
  dbs_update_service_last_checked: dateSchema.optional(),
  dbs_barred_list_check: z.boolean().optional(),
  rtw_document_type:    z.string().max(100).nullable().optional(),
  rtw_check_date:       dateSchema.optional(),
  rtw_document_expiry:  dateSchema.optional(),
  rtw_next_check_due:   dateSchema.optional(),
});

const renewalUpdateSchema = z.object({
  check_type:           z.enum(['dbs','rtw']).optional(),
  last_checked:         dateSchema.nullable().optional(),
  expiry_date:          dateSchema.nullable().optional(),
  reference:            z.string().max(200).nullable().optional(),
  certificate_number:   z.string().max(200).nullable().optional(),
  document_type:        z.string().max(100).nullable().optional(),
  status:               z.enum(['current','due_soon','overdue','pending','expired']).optional(),
  checked_by:           z.string().max(200).nullable().optional(),
  notes:                z.string().max(5000).nullable().optional(),
  dbs_certificate_number: z.string().max(200).nullable().optional(),
  dbs_disclosure_level: z.string().max(50).nullable().optional(),
  dbs_check_date:       dateSchema.nullable().optional(),
  dbs_next_renewal_due: dateSchema.nullable().optional(),
  dbs_update_service_registered: z.boolean().optional(),
  dbs_update_service_last_checked: dateSchema.nullable().optional(),
  dbs_barred_list_check: z.boolean().optional(),
  rtw_document_type:    z.string().max(100).nullable().optional(),
  rtw_check_date:       dateSchema.nullable().optional(),
  rtw_document_expiry:  dateSchema.nullable().optional(),
  rtw_next_check_due:   dateSchema.nullable().optional(),
});

// ── Case Note Schemas ───────────────────────────────────────────────────────

const caseNoteBodySchema = z.object({
  note: z.string().min(1).max(5000),
});

// Field mappers and diffFields imported from lib/hrFieldMappers.js

// ── Case Route Factory ──────────────────────────────────────────────────────

function registerCaseRoutes(router, { type, path, bodySchema, updateSchema, mapFields, filters, hasGetById = true, repoFind, repoFindById, repoCreate, repoUpdate, auditPrefix }) {
  const prefix = auditPrefix || type;

  // GET list
  router.get(path, requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const home = await resolveHome(req, res);
      if (!home) return;
      const f = {};
      for (const [queryParam, filterKey] of Object.entries(filters || {})) {
        if (req.query[queryParam]) f[filterKey] = req.query[queryParam];
      }
      const pag = { limit: req.query.limit, offset: req.query.offset };
      const result = await repoFind(home.id, f, null, pag);
      res.json(result);
    } catch (err) { next(err); }
  });

  // POST create
  router.post(path, requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const home = await resolveHome(req, res);
      if (!home) return;
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message, details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
      const mapped = mapFields ? mapFields(parsed.data) : parsed.data;
      const result = await repoCreate(home.id, { ...mapped, created_by: req.user.username });
      await auditService.log(`hr_${prefix}_create`, home.slug, req.user.username, { id: result.id });
      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  // GET by ID
  if (hasGetById) {
    router.get(`${path}/:id`, requireAuth, requireAdmin, async (req, res, next) => {
      try {
        const home = await resolveHome(req, res);
        if (!home) return;
        const parsed = idSchema.safeParse(req.params.id);
        if (!parsed.success) return res.status(400).json({ error: 'Invalid case ID' });
        const row = await repoFindById(parsed.data, home.id);
        if (!row) return res.status(404).json({ error: `${type} case not found` });
        res.json(row);
      } catch (err) { next(err); }
    });
  }

  // PUT update — with optimistic locking + field-diff audit
  router.put(`${path}/:id`, requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const home = await resolveHome(req, res);
      if (!home) return;
      const idParsed = idSchema.safeParse(req.params.id);
      if (!idParsed.success) return res.status(400).json({ error: 'Invalid case ID' });
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message, details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });

      const version = req.body._version != null ? parseInt(req.body._version) : null;
      const existing = repoFindById ? await repoFindById(idParsed.data, home.id) : null;
      if (repoFindById && !existing) return res.status(404).json({ error: `${type} case not found` });

      const mapped = mapFields ? mapFields(parsed.data) : parsed.data;
      const result = await repoUpdate(idParsed.data, home.id, mapped, null, version);
      if (result === null) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });

      const changes = existing ? diffFields(existing, result) : [];
      await auditService.log(`hr_${prefix}_update`, home.slug, req.user.username, { id: result.id, changes });
      res.json(result);
    } catch (err) { next(err); }
  });
}

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

// ── Case Type Registrations ─────────────────────────────────────────────────

registerCaseRoutes(router, {
  type: 'disciplinary', path: '/cases/disciplinary',
  bodySchema: disciplinaryBodySchema, updateSchema: disciplinaryUpdateSchema,
  mapFields: mapDisciplinaryFields,
  filters: { staff_id: 'staffId', status: 'status' },
  repoFind: hrRepo.findDisciplinary, repoFindById: hrRepo.findDisciplinaryById,
  repoCreate: hrRepo.createDisciplinary, repoUpdate: hrRepo.updateDisciplinary,
});

registerCaseRoutes(router, {
  type: 'grievance', path: '/cases/grievance',
  bodySchema: grievanceBodySchema, updateSchema: grievanceUpdateSchema,
  mapFields: mapGrievanceFields,
  filters: { staff_id: 'staffId', status: 'status' },
  repoFind: hrRepo.findGrievance, repoFindById: hrRepo.findGrievanceById,
  repoCreate: hrRepo.createGrievance, repoUpdate: hrRepo.updateGrievance,
});

// ── Grievance Actions ───────────────────────────────────────────────────────

// GET /api/hr/cases/grievance/:id/actions?home=X
router.get('/cases/grievance/:id/actions', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid case ID' });
    res.json(await hrRepo.findGrievanceActions(idP.data, home.id));
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
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await hrRepo.createGrievanceAction(idP.data, home.id, parsed.data);
    await auditService.log('hr_grievance_action_create', home.slug, req.user.username, { id: result.id });
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
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await hrRepo.updateGrievanceAction(idP.data, home.id, parsed.data);
    if (!result) return res.status(404).json({ error: 'Grievance action not found' });
    await auditService.log('hr_grievance_action_update', home.slug, req.user.username, { id: result.id });
    res.json(result);
  } catch (err) { next(err); }
});

registerCaseRoutes(router, {
  type: 'performance', path: '/cases/performance',
  bodySchema: performanceBodySchema, updateSchema: performanceUpdateSchema,
  mapFields: mapPerformanceFields,
  filters: { staff_id: 'staffId', status: 'status', type: 'type' },
  repoFind: hrRepo.findPerformance, repoFindById: hrRepo.findPerformanceById,
  repoCreate: hrRepo.createPerformance, repoUpdate: hrRepo.updatePerformance,
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

registerCaseRoutes(router, {
  type: 'rtw_interview', path: '/rtw-interviews',
  bodySchema: rtwInterviewBodySchema, updateSchema: rtwInterviewUpdateSchema,
  mapFields: mapRtwFields,
  filters: { staff_id: 'staffId' },
  repoFind: hrRepo.findRtwInterviews, repoFindById: hrRepo.findRtwInterviewById,
  repoCreate: hrRepo.createRtwInterview, repoUpdate: hrRepo.updateRtwInterview,
  auditPrefix: 'rtw',
});

registerCaseRoutes(router, {
  type: 'oh_referral', path: '/oh-referrals',
  bodySchema: ohReferralBodySchema, updateSchema: ohReferralUpdateSchema,
  mapFields: mapOhFields,
  filters: { staff_id: 'staffId', status: 'status' },
  repoFind: hrRepo.findOhReferrals, repoFindById: hrRepo.findOhReferralById,
  repoCreate: hrRepo.createOhReferral, repoUpdate: hrRepo.updateOhReferral,
  auditPrefix: 'oh_referral',
});

registerCaseRoutes(router, {
  type: 'contract', path: '/contracts',
  bodySchema: contractBodySchema, updateSchema: contractUpdateSchema,
  mapFields: mapContractFields,
  filters: { staff_id: 'staffId', status: 'status' },
  repoFind: hrRepo.findContracts, repoFindById: hrRepo.findContractById,
  repoCreate: hrRepo.createContract, repoUpdate: hrRepo.updateContract,
});

registerCaseRoutes(router, {
  type: 'family_leave', path: '/family-leave',
  bodySchema: familyLeaveBodySchema, updateSchema: familyLeaveUpdateSchema,
  mapFields: mapFamilyLeaveFields,
  filters: { staff_id: 'staffId', type: 'type' },
  repoFind: hrRepo.findFamilyLeave, repoFindById: hrRepo.findFamilyLeaveById,
  repoCreate: hrRepo.createFamilyLeave, repoUpdate: hrRepo.updateFamilyLeave,
});

registerCaseRoutes(router, {
  type: 'flexible_working', path: '/flexible-working',
  bodySchema: flexWorkingBodySchema, updateSchema: flexWorkingUpdateSchema,
  mapFields: mapFlexFields,
  filters: { staff_id: 'staffId', status: 'status' },
  repoFind: hrRepo.findFlexWorking, repoFindById: hrRepo.findFlexWorkingById,
  repoCreate: hrRepo.createFlexWorking, repoUpdate: hrRepo.updateFlexWorking,
  auditPrefix: 'flex_working',
});

registerCaseRoutes(router, {
  type: 'edi', path: '/edi',
  bodySchema: ediBodySchema, updateSchema: ediUpdateSchema,
  mapFields: mapEdiFields,
  filters: { record_type: 'recordType', staff_id: 'staffId' },
  repoFind: hrRepo.findEdi, repoFindById: hrRepo.findEdiById,
  repoCreate: hrRepo.createEdi, repoUpdate: hrRepo.updateEdi,
});

registerCaseRoutes(router, {
  type: 'tupe', path: '/tupe',
  bodySchema: tupeBodySchema, updateSchema: tupeUpdateSchema,
  mapFields: mapTupeFields,
  filters: {},
  repoFind: (homeId, _f, client, pag) => hrRepo.findTupe(homeId, client, pag),
  repoFindById: hrRepo.findTupeById,
  repoCreate: hrRepo.createTupe, repoUpdate: hrRepo.updateTupe,
});

registerCaseRoutes(router, {
  type: 'renewal', path: '/renewals',
  bodySchema: renewalBodySchema, updateSchema: renewalUpdateSchema,
  mapFields: mapRenewalFields,
  filters: { staff_id: 'staffId', check_type: 'checkType', status: 'status' },
  repoFind: hrRepo.findRenewals, repoFindById: hrRepo.findRenewalById,
  repoCreate: hrRepo.createRenewal, repoUpdate: hrRepo.updateRenewal,
  auditPrefix: 'dbs_renewal',
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
    res.json(await hrRepo.findCaseNotes(home.id, caseTypeP.data, caseIdP.data));
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
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await hrRepo.createCaseNote(home.id, caseTypeP.data, caseIdP.data, {
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
    const files = await hrRepo.findAttachments(parsed.data, caseId, home.id);
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
        // Verify file magic bytes match declared MIME type
        const filePath = req.file.path;
        const detected = await fileTypeFromFile(filePath);
        if (detected && detected.mime !== req.file.mimetype) {
          await unlink(filePath).catch(() => {});
          return res.status(400).json({ error: 'File content does not match declared type' });
        }
        const descParsed = z.string().max(500).optional().safeParse(req.body.description);
        const description = descParsed.success ? (descParsed.data || null) : null;
        const attachment = await hrRepo.createAttachment(home.id, caseTypeParsed.data, caseId, {
          original_name: req.file.originalname,
          stored_name: req.file.filename,
          mime_type: req.file.mimetype,
          size_bytes: req.file.size,
          description: description,
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
    const att = await hrRepo.findAttachmentById(id, home.id);
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
    const att = await hrRepo.deleteAttachment(id, home.id);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    // Delete file from disk (best effort)
    const filePath = path.join(config.upload.dir, String(home.id), att.case_type, String(att.case_id), att.stored_name);
    await unlink(filePath).catch(() => {});
    await auditService.log('hr_attachment_delete', home.slug, req.user.username, { id, caseType: att.case_type, caseId: att.case_id });
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
    const meetings = await hrRepo.findMeetings(parsed.data, caseId, home.id);
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
    const meeting = await hrRepo.createMeeting(home.id, ctParsed.data, caseId, {
      ...parsed.data,
      recorded_by: req.user.username,
    });
    await auditService.log(`hr_${ctParsed.data}_meeting_create`, home.slug, req.user.username, { id: meeting.id });
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
    const meeting = await hrRepo.updateMeeting(id, home.id, parsed.data);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    await auditService.log(`hr_${meeting.case_type}_meeting_update`, home.slug, req.user.username, { id: meeting.id });
    res.json(meeting);
  } catch (err) { next(err); }
});

// ── GDPR Retention ──────────────────────────────────────────────────────────

router.post('/admin/purge-expired', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const retentionYears = parseInt(req.body.retention_years) || 6;
    const dryRun = req.body.dry_run !== false;
    const counts = await hrRepo.purgeExpiredRecords(home.id, retentionYears, dryRun);
    await auditService.log(dryRun ? 'hr_purge_preview' : 'hr_purge_execute', home.slug, req.user.username, { retentionYears, counts });
    res.json({ dry_run: dryRun, retention_years: retentionYears, counts });
  } catch (err) { next(err); }
});

router.get('/admin/audit-export', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const from = req.query.from || '1970-01-01';
    const to = req.query.to || '9999-12-31';
    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE home_slug = $1 AND action LIKE 'hr_%' AND ts >= $2 AND ts <= $3 ORDER BY ts DESC`,
      [home.slug, from, to]
    );
    res.setHeader('Content-Disposition', `attachment; filename="hr-audit-${home.slug}-${from}-${to}.json"`);
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
