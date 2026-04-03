/**
 * HR field mapping functions — translate frontend aliases to DB column names.
 * Also includes diffFields helper for audit logging of field-level changes.
 *
 * These are pure functions with zero external dependencies,
 * extracted from routes/hr.js for testability.
 */

// ── Field Mapping Functions ──────────────────────────────────────────────────

const FLEX_REFUSAL_REASONS = new Set([
  'burden_of_additional_costs',
  'detrimental_to_meet_customer_demand',
  'inability_to_reorganise_work',
  'inability_to_recruit_additional_staff',
  'detrimental_to_quality',
  'detrimental_to_performance',
  'insufficiency_of_work_during_periods',
  'planned_structural_changes',
]);

const RTW_DOCUMENT_TYPE_MAP = new Map([
  ['passport', 'passport'],
  ['uk_passport', 'passport'],
  ['uk passport', 'passport'],
  ['brp', 'brp'],
  ['biometric_residence_permit', 'brp'],
  ['biometric residence permit', 'brp'],
  ['share_code', 'share_code'],
  ['share code', 'share_code'],
  ['settled_status', 'settled_status'],
  ['settled status', 'settled_status'],
  ['pre_settled', 'pre_settled'],
  ['pre settled', 'pre_settled'],
  ['pre-settled', 'pre_settled'],
]);

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function normalizeRtwDocumentType(value) {
  if (value == null || value === '') return value;
  const normalized = normalizeToken(value);
  return RTW_DOCUMENT_TYPE_MAP.get(normalized) || normalized;
}

export function mapDisciplinaryFields(data) {
  const m = { ...data };
  if ('outcome_notes' in m && !('outcome_reason' in m)) { m.outcome_reason = m.outcome_notes; delete m.outcome_notes; }
  if ('appeal_date' in m && !('appeal_received_date' in m)) { m.appeal_received_date = m.appeal_date; delete m.appeal_date; }
  return m;
}

export function mapPerformanceFields(data) {
  const m = { ...data };
  if ('description' in m && !('concern_summary' in m)) { m.concern_summary = m.description; delete m.description; }
  if ('informal_notes' in m && !('informal_discussion_notes' in m)) { m.informal_discussion_notes = m.informal_notes; delete m.informal_notes; }
  if ('appeal_date' in m && !('appeal_received_date' in m)) { m.appeal_received_date = m.appeal_date; delete m.appeal_date; }
  delete m.manager;
  delete m.pip_review_dates;
  return m;
}

export function mapRtwFields(data) {
  const m = { ...data };
  if ('conducted_by' in m && !('rtw_conducted_by' in m)) { m.rtw_conducted_by = m.conducted_by; delete m.conducted_by; }
  if ('fit_for_work' in m && !('fit_to_return' in m)) { m.fit_to_return = m.fit_for_work; delete m.fit_for_work; }
  if ('adjustments' in m && !('adjustments_needed' in m)) { m.adjustments_needed = !!m.adjustments; m.adjustments_detail = m.adjustments; delete m.adjustments; }
  if ('referral_needed' in m && !('oh_referral_recommended' in m)) { m.oh_referral_recommended = m.referral_needed; delete m.referral_needed; }
  return m;
}

export function mapOhFields(data) {
  const m = { ...data };
  if ('provider' in m && !('oh_provider' in m)) { m.oh_provider = m.provider; delete m.provider; }
  if ('report_date' in m && !('report_received_date' in m)) { m.report_received_date = m.report_date; delete m.report_date; }
  if ('recommendations' in m && !('adjustments_recommended' in m)) { m.adjustments_recommended = m.recommendations; delete m.recommendations; }
  if ('questions_for_oh' in m && typeof m.questions_for_oh === 'string') {
    m.questions_for_oh = m.questions_for_oh
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  delete m.report_received;
  return m;
}

export function mapContractFields(data) {
  const m = { ...data };
  if ('start_date' in m && !('contract_start_date' in m)) { m.contract_start_date = m.start_date; delete m.start_date; }
  if ('end_date' in m && !('contract_end_date' in m)) { m.contract_end_date = m.end_date; delete m.end_date; }
  delete m.salary;
  delete m.notice_period_weeks;
  delete m.signed_date;
  return m;
}

export function mapFamilyLeaveFields(data) {
  const m = { ...data };
  if ('leave_type' in m && !('type' in m)) { m.type = m.leave_type; delete m.leave_type; }
  if ('start_date' in m && !('leave_start_date' in m)) { m.leave_start_date = m.start_date; delete m.start_date; }
  if ('end_date' in m && !('leave_end_date' in m)) { m.leave_end_date = m.end_date; delete m.end_date; }
  if ('expected_return' in m && !('expected_return_date' in m)) { m.expected_return_date = m.expected_return; delete m.expected_return; }
  if ('actual_return' in m && !('actual_return_date' in m)) { m.actual_return_date = m.actual_return; delete m.actual_return; }
  if ('kit_days_used' in m && !('kit_days' in m)) { m.kit_days = m.kit_days_used; delete m.kit_days_used; }
  if ('pay_type' in m && !('statutory_pay_type' in m)) { m.statutory_pay_type = m.pay_type; delete m.pay_type; }
  return m;
}

export function mapFlexFields(data) {
  const m = { ...data };
  if ('decision_reason' in m && !('refusal_reason' in m) && !('refusal_explanation' in m)) {
    if (m.decision === 'refused' && FLEX_REFUSAL_REASONS.has(m.decision_reason)) m.refusal_reason = m.decision_reason;
    else m.refusal_explanation = m.decision_reason;
    delete m.decision_reason;
  }
  if (m.status === 'withdrawn' && !('decision' in m)) m.decision = 'withdrawn';
  if (m.decision === 'withdrawn' && !('status' in m)) m.status = 'withdrawn';
  delete m.proposed_pattern;
  return m;
}

export function mapEdiFields(data, current = null) {
  const m = { ...data };
  const recordType = m.record_type || current?.record_type;
  if ('date_recorded' in m && !('complaint_date' in m)) { m.complaint_date = m.date_recorded; delete m.date_recorded; }
  if ('category' in m) {
    if (recordType === 'reasonable_adjustment') {
      if (!('description' in m)) m.description = m.category;
    } else if (!('harassment_category' in m)) {
      m.harassment_category = m.category;
    }
    delete m.category;
  }
  if ('respondent_role' in m && !('respondent_type' in m)) { m.respondent_type = m.respondent_role; delete m.respondent_role; }
  delete m.data;
  return m;
}

export function mapTupeFields(data) {
  const m = { ...data };
  if ('staff_affected' in m && !('employees' in m)) { m.employees = m.staff_affected != null ? { count: m.staff_affected } : null; delete m.staff_affected; }
  if ('consultation_start' in m && !('consultation_start_date' in m)) { m.consultation_start_date = m.consultation_start; delete m.consultation_start; }
  if ('consultation_end' in m && !('consultation_end_date' in m)) { m.consultation_end_date = m.consultation_end; delete m.consultation_end; }
  if ('eli_sent_date' in m && !('eli_received_date' in m)) { m.eli_received_date = m.eli_sent_date; delete m.eli_sent_date; }
  if ('measures_proposed' in m && !('measures_description' in m)) { m.measures_description = m.measures_proposed; delete m.measures_proposed; }
  return m;
}

export function mapRenewalFields(data, current = null) {
  const m = { ...data };
  const checkType = m.check_type || current?.check_type;
  const isDbs = checkType === 'dbs';
  if ('last_checked' in m) {
    const target = isDbs ? 'dbs_check_date' : 'rtw_check_date';
    if (!(target in m)) m[target] = m.last_checked;
    delete m.last_checked;
  }
  if ('expiry_date' in m) {
    const target = isDbs ? 'dbs_next_renewal_due' : 'rtw_document_expiry';
    if (!(target in m)) m[target] = m.expiry_date;
    delete m.expiry_date;
  }
  if ('certificate_number' in m && isDbs) {
    if (!('dbs_certificate_number' in m) && m.certificate_number != null && m.certificate_number !== '') {
      m.dbs_certificate_number = m.certificate_number;
    }
    delete m.certificate_number;
  }
  if ('reference' in m) {
    if (isDbs && !('dbs_certificate_number' in m)) m.dbs_certificate_number = m.reference;
    delete m.reference;
  }
  if ('document_type' in m && !('rtw_document_type' in m)) {
    m.rtw_document_type = normalizeRtwDocumentType(m.document_type);
    delete m.document_type;
  }
  if ('rtw_document_type' in m) m.rtw_document_type = normalizeRtwDocumentType(m.rtw_document_type);
  if ('check_type' in m) {
    if (m.check_type === 'dbs') {
      if (!('rtw_document_type' in m)) m.rtw_document_type = null;
      if (!('rtw_check_date' in m)) m.rtw_check_date = null;
      if (!('rtw_document_expiry' in m)) m.rtw_document_expiry = null;
      if (!('rtw_next_check_due' in m)) m.rtw_next_check_due = null;
    } else if (m.check_type === 'rtw') {
      if (!('dbs_certificate_number' in m)) m.dbs_certificate_number = null;
      if (!('dbs_disclosure_level' in m)) m.dbs_disclosure_level = null;
      if (!('dbs_check_date' in m)) m.dbs_check_date = null;
      if (!('dbs_next_renewal_due' in m)) m.dbs_next_renewal_due = null;
      if (!('dbs_update_service_registered' in m)) m.dbs_update_service_registered = null;
      if (!('dbs_update_service_last_checked' in m)) m.dbs_update_service_last_checked = null;
      if (!('dbs_barred_list_check' in m)) m.dbs_barred_list_check = null;
    }
  }
  return m;
}

export function mapGrievanceFields(data) {
  const m = { ...data };
  if ('description' in m && !('subject_summary' in m)) {
    m.subject_summary = m.description;
    delete m.description;
  }
  return m;
}

// ── Diff Helper (re-exported from shared lib/audit.js) ──────────────────────

export { diffFields } from './audit.js';
