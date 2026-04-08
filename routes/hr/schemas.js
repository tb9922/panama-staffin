import { z } from 'zod';
import { nullableDateInput, nullableEnumInput } from '../../lib/zodHelpers.js';

// ── Shared Schemas ──────────────────────────────────────────────────────────

export const idSchema = z.coerce.number().int().positive();
export const dateSchema = nullableDateInput;
export const staffIdSchema = z.string().min(1).max(20);
export const caseTypeSchema = z.enum([
  'disciplinary', 'grievance', 'performance', 'rtw_interview',
  'oh_referral', 'contract', 'family_leave', 'flexible_working',
  'edi', 'tupe', 'renewal',
]);

// ── Disciplinary Schemas ────────────────────────────────────────────────────

const jsonOrArray = z.preprocess(
  v => { if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } } return v; },
  z.array(z.object({}).passthrough()).max(100)
).refine(
  v => JSON.stringify(v).length <= 50000,
  'Structured data is too large'
);

const grievanceActionStatusSchema = z.preprocess(
  v => {
    if (v === '') return null;
    if (v === 'open') return 'pending';
    return v;
  },
  z.enum(['pending', 'in_progress', 'completed', 'cancelled']).nullable().optional()
);

export const disciplinaryBodySchema = z.object({
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

export const disciplinaryUpdateSchema = z.object({
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

export const grievanceBodySchema = z.object({
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

export const grievanceUpdateSchema = z.object({
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
  witnesses:            z.array(z.object({ name: z.string().max(200).optional(), role: z.string().max(200).optional(), statement_summary: z.string().max(5000).optional() }).passthrough()).max(50).optional(),
  evidence_items:       z.array(z.object({ description: z.string().max(5000).optional(), date: dateSchema.optional(), type: z.string().max(100).optional() }).passthrough()).max(50).optional(),
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

export const grievanceActionBodySchema = z.object({
  description:  z.string().min(1).max(2000),
  responsible:  z.string().max(200).optional(),
  due_date:     dateSchema.optional(),
  status:       grievanceActionStatusSchema,
});

export const grievanceActionUpdateSchema = z.object({
  description:    z.string().min(1).max(2000).optional(),
  responsible:    z.string().max(200).nullable().optional(),
  due_date:       dateSchema.nullable().optional(),
  completed_date: dateSchema.nullable().optional(),
  status:         grievanceActionStatusSchema,
  _version:       z.number().int().positive(),
});

// ── Performance Schemas ─────────────────────────────────────────────────────

export const performanceBodySchema = z.object({
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

export const performanceUpdateSchema = z.object({
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

export const rtwInterviewBodySchema = z.object({
  staff_id:           staffIdSchema,
  absence_start_date: dateSchema,
  rtw_date:           dateSchema,
  absence_end_date:   dateSchema.optional(),
  absence_reason:     z.string().max(200).optional(),
  conducted_by:       z.string().min(1).max(200),
  fit_for_work:       z.boolean().optional(),
  adjustments:        z.string().max(2000).nullable().optional(),
  referral_needed:    z.boolean().optional(),
  underlying_condition: z.boolean().optional(),
  follow_up_date:     dateSchema.optional(),
  fit_note_received:  z.boolean().optional(),
  fit_note_date:      dateSchema.optional(),
  fit_note_type:      nullableEnumInput(['not_fit', 'may_be_fit']).optional(),
  fit_note_adjustments: z.string().max(5000).nullable().optional(),
  fit_note_review_date: dateSchema.optional(),
  bradford_score_after: z.coerce.number().nonnegative().nullable().optional(),
  trigger_reached:    nullableEnumInput(['none', 'informal', 'formal_1', 'formal_2', 'final']).optional(),
  action_taken:       nullableEnumInput(['none', 'informal_chat', 'formal_meeting', 'referral']).optional(),
  notes:              z.string().max(5000).nullable().optional(),
});

export const rtwInterviewUpdateSchema = z.object({
  absence_start_date: dateSchema.optional(),
  absence_end_date:   dateSchema.nullable().optional(),
  rtw_date:           dateSchema.optional(),
  absence_reason:     z.string().max(200).nullable().optional(),
  conducted_by:       z.string().max(200).nullable().optional(),
  fit_for_work:       z.boolean().optional(),
  adjustments:        z.string().max(2000).nullable().optional(),
  referral_needed:    z.boolean().optional(),
  underlying_condition: z.boolean().optional(),
  follow_up_date:     dateSchema.nullable().optional(),
  fit_note_received:  z.boolean().optional(),
  fit_note_date:      dateSchema.nullable().optional(),
  fit_note_type:      nullableEnumInput(['not_fit', 'may_be_fit']).optional(),
  fit_note_adjustments: z.string().max(5000).nullable().optional(),
  fit_note_review_date: dateSchema.nullable().optional(),
  bradford_score_after: z.coerce.number().nonnegative().nullable().optional(),
  trigger_reached:    nullableEnumInput(['none', 'informal', 'formal_1', 'formal_2', 'final']).optional(),
  action_taken:       nullableEnumInput(['none', 'informal_chat', 'formal_meeting', 'referral']).optional(),
  notes:              z.string().max(5000).nullable().optional(),
});

// ── OH Referral Schemas ─────────────────────────────────────────────────────

export const ohReferralBodySchema = z.object({
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
  employee_consent_obtained: z.boolean().optional(),
  consent_date:     dateSchema.optional(),
  questions_for_oh: z.string().max(5000).nullable().optional(),
  report_summary:   z.string().max(5000).nullable().optional(),
  fit_for_role:     nullableEnumInput(['yes', 'yes_with_adjustments', 'no_currently', 'no_permanently']).optional(),
  disability_likely: nullableEnumInput(['yes', 'no', 'possible']).optional(),
  estimated_return_date: dateSchema.optional(),
  follow_up_date:   dateSchema.optional(),
  notes:            z.string().max(5000).nullable().optional(),
});

export const ohReferralUpdateSchema = z.object({
  referral_date:    dateSchema.optional(),
  reason:           z.string().min(1).max(2000).optional(),
  referred_by:      z.string().max(200).nullable().optional(),
  status:           z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  provider:         z.string().max(200).nullable().optional(),
  appointment_date: dateSchema.nullable().optional(),
  report_received:  z.boolean().optional(),
  report_date:      dateSchema.nullable().optional(),
  recommendations:  z.string().max(5000).nullable().optional(),
  employee_consent_obtained: z.boolean().optional(),
  consent_date:     dateSchema.nullable().optional(),
  questions_for_oh: z.string().max(5000).nullable().optional(),
  report_summary:   z.string().max(5000).nullable().optional(),
  fit_for_role:     nullableEnumInput(['yes', 'yes_with_adjustments', 'no_currently', 'no_permanently']).optional(),
  disability_likely: nullableEnumInput(['yes', 'no', 'possible']).optional(),
  estimated_return_date: dateSchema.nullable().optional(),
  follow_up_date:   dateSchema.nullable().optional(),
  notes:            z.string().max(5000).nullable().optional(),
});

// ── Contract Schemas ────────────────────────────────────────────────────────

export const contractBodySchema = z.object({
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

export const contractUpdateSchema = z.object({
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

export const familyLeaveBodySchema = z.object({
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

export const familyLeaveUpdateSchema = z.object({
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

export const flexWorkingBodySchema = z.object({
  staff_id:           staffIdSchema,
  request_date:       dateSchema,
  requested_change:   z.string().min(1).max(2000),
  effective_date_requested: dateSchema.optional(),
  decision_deadline:  dateSchema,
  status:             z.enum(['pending','meeting_scheduled','decided','implemented','appealed','withdrawn']).optional(),
  reason:             z.string().max(2000).nullable().optional(),
  current_pattern:    z.string().max(500).nullable().optional(),
  proposed_pattern:   z.string().max(500).nullable().optional(),
  employee_assessment_of_impact: z.string().max(2000).nullable().optional(),
  meeting_date:       dateSchema.optional(),
  meeting_notes:      z.string().max(5000).nullable().optional(),
  decision:           nullableEnumInput(['approved', 'approved_modified', 'refused', 'withdrawn']).optional(),
  decision_date:      dateSchema.optional(),
  decision_reason:    z.string().max(2000).nullable().optional(),
  decision_by:        z.string().max(200).nullable().optional(),
  refusal_reason:     z.string().max(100).nullable().optional(),
  refusal_explanation: z.string().max(5000).nullable().optional(),
  approved_pattern:   z.string().max(500).nullable().optional(),
  approved_effective_date: dateSchema.optional(),
  trial_period:       z.boolean().optional(),
  trial_period_end:   dateSchema.optional(),
  appeal_date:        dateSchema.optional(),
  appeal_grounds:     z.string().max(5000).nullable().optional(),
  appeal_outcome:     nullableEnumInput(['upheld', 'overturned', 'modified']).optional(),
  appeal_outcome_date: dateSchema.optional(),
  notes:              z.string().max(5000).nullable().optional(),
});

export const flexWorkingUpdateSchema = z.object({
  request_date:       dateSchema.optional(),
  requested_change:   z.string().min(1).max(2000).optional(),
  effective_date_requested: dateSchema.nullable().optional(),
  decision_deadline:  dateSchema.optional(),
  status:             z.enum(['pending','meeting_scheduled','decided','implemented','appealed','withdrawn']).optional(),
  reason:             z.string().max(2000).nullable().optional(),
  current_pattern:    z.string().max(500).nullable().optional(),
  proposed_pattern:   z.string().max(500).nullable().optional(),
  employee_assessment_of_impact: z.string().max(2000).nullable().optional(),
  meeting_date:       dateSchema.nullable().optional(),
  meeting_notes:      z.string().max(5000).nullable().optional(),
  decision:           nullableEnumInput(['approved', 'approved_modified', 'refused', 'withdrawn']).optional(),
  decision_date:      dateSchema.nullable().optional(),
  decision_reason:    z.string().max(2000).nullable().optional(),
  decision_by:        z.string().max(200).nullable().optional(),
  refusal_reason:     z.string().max(100).nullable().optional(),
  refusal_explanation: z.string().max(5000).nullable().optional(),
  approved_pattern:   z.string().max(500).nullable().optional(),
  approved_effective_date: dateSchema.nullable().optional(),
  trial_period:       z.boolean().optional(),
  trial_period_end:   dateSchema.nullable().optional(),
  appeal_date:        dateSchema.nullable().optional(),
  appeal_grounds:     z.string().max(5000).nullable().optional(),
  appeal_outcome:     nullableEnumInput(['upheld', 'overturned', 'modified']).optional(),
  appeal_outcome_date: dateSchema.nullable().optional(),
  notes:              z.string().max(5000).nullable().optional(),
});

// ── EDI Schemas ─────────────────────────────────────────────────────────────

export const ediBodySchema = z.object({
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
  status:               z.enum(['open', 'investigating', 'resolved', 'closed', 'escalated']).nullable().optional(),
  outcome:              z.string().max(5000).nullable().optional(),
  notes:                z.string().max(5000).nullable().optional(),
});

export const ediUpdateSchema = z.object({
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
  status:               z.enum(['open', 'investigating', 'resolved', 'closed', 'escalated']).nullable().optional(),
  outcome:              z.string().max(5000).nullable().optional(),
  notes:                z.string().max(5000).nullable().optional(),
});

// ── TUPE Schemas ────────────────────────────────────────────────────────────

export const tupeBodySchema = z.object({
  transfer_type:    z.string().min(1).max(100),
  transfer_date:    dateSchema,
  signed_date:      dateSchema.optional(),
  transferor_name:  z.string().min(1).max(200),
  transferee_name:  z.string().min(1).max(200),
  status:           z.enum(['planned','consultation','transferred','complete']).optional(),
  staff_affected:   z.number().int().nonnegative().optional(),
  consultation_start: dateSchema.optional(),
  consultation_end:   dateSchema.optional(),
  eli_sent_date:    dateSchema.optional(),
  measures_letter_date: dateSchema.optional(),
  measures_proposed: z.string().max(5000).nullable().optional(),
  employee_reps_consulted: z.boolean().optional(),
  rep_names:        z.string().max(500).nullable().optional(),
  eli_complete:     z.boolean().optional(),
  dd_notes:         z.string().max(5000).nullable().optional(),
  outstanding_claims: z.string().max(5000).nullable().optional(),
  outstanding_tribunal_claims: z.string().max(5000).nullable().optional(),
  notes:            z.string().max(5000).nullable().optional(),
});

export const tupeUpdateSchema = z.object({
  transfer_type:    z.string().min(1).max(100).optional(),
  transfer_date:    dateSchema.optional(),
  signed_date:      dateSchema.nullable().optional(),
  transferor_name:  z.string().min(1).max(200).optional(),
  transferee_name:  z.string().min(1).max(200).optional(),
  status:           z.enum(['planned','consultation','transferred','complete']).optional(),
  staff_affected:   z.number().int().nonnegative().optional(),
  consultation_start: dateSchema.nullable().optional(),
  consultation_end:   dateSchema.nullable().optional(),
  eli_sent_date:    dateSchema.nullable().optional(),
  measures_letter_date: dateSchema.nullable().optional(),
  measures_proposed: z.string().max(5000).nullable().optional(),
  employee_reps_consulted: z.boolean().optional(),
  rep_names:        z.string().max(500).nullable().optional(),
  eli_complete:     z.boolean().optional(),
  dd_notes:         z.string().max(5000).nullable().optional(),
  outstanding_claims: z.string().max(5000).nullable().optional(),
  outstanding_tribunal_claims: z.string().max(5000).nullable().optional(),
  notes:            z.string().max(5000).nullable().optional(),
});

// ── Renewal Schemas ─────────────────────────────────────────────────────────

export const renewalBodySchema = z.object({
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

export const renewalUpdateSchema = z.object({
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

export const caseNoteBodySchema = z.object({
  note: z.string().min(1).max(5000),
});

// ── Meeting Schemas ─────────────────────────────────────────────────────────

export const meetingBodySchema = z.object({
  meeting_date:  dateSchema,
  meeting_time:  z.string().max(10).optional(),
  meeting_type:  z.enum(['interview', 'hearing', 'review', 'informal']).optional(),
  location:      z.string().max(200).optional(),
  attendees:     z.array(z.object({
    staff_id: z.string().max(20).optional(),
    name: z.string().max(200),
    role_in_meeting: z.enum(['subject', 'investigator', 'witness', 'companion', 'note_taker', 'hr_advisor', 'chair']),
  })).max(50).optional(),
  summary:       z.string().max(10000).optional(),
  key_points:    z.string().max(10000).optional(),
  outcome:       z.string().max(5000).optional(),
});

export const meetingCaseTypeSchema = z.enum(['disciplinary', 'grievance', 'performance']);
