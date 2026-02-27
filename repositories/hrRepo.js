import { pool } from '../db.js';

function d(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : v; }
function ts(v) { return v instanceof Date ? v.toISOString() : v; }

// ── Disciplinary Cases ──────────────────────────────────────────────────────

function shapeDisc(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id, staff_id: row.staff_id,
    date_raised: d(row.date_raised), raised_by: row.raised_by,
    source: row.source, source_ref: row.source_ref, category: row.category,
    allegation_summary: row.allegation_summary, allegation_detail: row.allegation_detail,
    investigation_status: row.investigation_status, investigation_officer: row.investigation_officer,
    investigation_start_date: d(row.investigation_start_date), investigation_notes: row.investigation_notes,
    witnesses: row.witnesses || [], evidence_items: row.evidence_items || [],
    investigation_completed_date: d(row.investigation_completed_date),
    investigation_findings: row.investigation_findings, investigation_recommendation: row.investigation_recommendation,
    suspended: row.suspended, suspension_date: d(row.suspension_date),
    suspension_reason: row.suspension_reason, suspension_review_date: d(row.suspension_review_date),
    suspension_end_date: d(row.suspension_end_date), suspension_on_full_pay: row.suspension_on_full_pay,
    hearing_status: row.hearing_status, hearing_date: d(row.hearing_date),
    hearing_time: row.hearing_time, hearing_location: row.hearing_location,
    hearing_chair: row.hearing_chair, hearing_letter_sent_date: d(row.hearing_letter_sent_date),
    hearing_companion_name: row.hearing_companion_name, hearing_companion_role: row.hearing_companion_role,
    hearing_notes: row.hearing_notes, hearing_employee_response: row.hearing_employee_response,
    outcome: row.outcome, outcome_date: d(row.outcome_date), outcome_reason: row.outcome_reason,
    outcome_letter_sent_date: d(row.outcome_letter_sent_date), outcome_letter_method: row.outcome_letter_method,
    warning_expiry_date: d(row.warning_expiry_date),
    notice_period_start: d(row.notice_period_start), notice_period_end: d(row.notice_period_end),
    pay_in_lieu_of_notice: row.pay_in_lieu_of_notice != null ? parseFloat(row.pay_in_lieu_of_notice) : null, dismissal_effective_date: d(row.dismissal_effective_date),
    appeal_status: row.appeal_status, appeal_received_date: d(row.appeal_received_date),
    appeal_deadline: d(row.appeal_deadline), appeal_grounds: row.appeal_grounds,
    appeal_hearing_date: d(row.appeal_hearing_date), appeal_hearing_chair: row.appeal_hearing_chair,
    appeal_hearing_companion_name: row.appeal_hearing_companion_name,
    appeal_outcome: row.appeal_outcome, appeal_outcome_date: d(row.appeal_outcome_date),
    appeal_outcome_reason: row.appeal_outcome_reason,
    appeal_outcome_letter_sent_date: d(row.appeal_outcome_letter_sent_date),
    linked_grievance_id: row.linked_grievance_id,
    disciplinary_paused_for_grievance: row.disciplinary_paused_for_grievance,
    status: row.status, closed_date: d(row.closed_date), closed_reason: row.closed_reason,
    created_by: row.created_by, created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findDisciplinary(homeId, { staffId, status } = {}, client) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_disciplinary_cases WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  sql += ' ORDER BY date_raised DESC';
  const { rows } = await conn.query(sql, params);
  return rows.map(shapeDisc);
}

export async function findDisciplinaryById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_disciplinary_cases WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL', [id, homeId]);
  return shapeDisc(rows[0]);
}

export async function createDisciplinary(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_disciplinary_cases
       (home_id, staff_id, date_raised, raised_by, source, source_ref, category,
        allegation_summary, allegation_detail, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [homeId, data.staff_id, data.date_raised, data.raised_by,
     data.source || 'other', data.source_ref || null, data.category,
     data.allegation_summary, data.allegation_detail || null,
     data.status || 'open', data.created_by]
  );
  return shapeDisc(rows[0]);
}

export async function updateDisciplinary(id, homeId, data, client) {
  const conn = client || pool;
  // Build dynamic SET clause from provided fields
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'investigation_status', 'investigation_officer', 'investigation_start_date',
    'investigation_notes', 'witnesses', 'evidence_items', 'investigation_completed_date',
    'investigation_findings', 'investigation_recommendation',
    'suspended', 'suspension_date', 'suspension_reason', 'suspension_review_date',
    'suspension_end_date', 'suspension_on_full_pay',
    'hearing_status', 'hearing_date', 'hearing_time', 'hearing_location',
    'hearing_chair', 'hearing_letter_sent_date', 'hearing_companion_name',
    'hearing_companion_role', 'hearing_notes', 'hearing_employee_response',
    'outcome', 'outcome_date', 'outcome_reason', 'outcome_letter_sent_date',
    'outcome_letter_method', 'warning_expiry_date',
    'notice_period_start', 'notice_period_end', 'pay_in_lieu_of_notice',
    'dismissal_effective_date',
    'appeal_status', 'appeal_received_date', 'appeal_deadline', 'appeal_grounds',
    'appeal_hearing_date', 'appeal_hearing_chair', 'appeal_hearing_companion_name',
    'appeal_outcome', 'appeal_outcome_date', 'appeal_outcome_reason',
    'appeal_outcome_letter_sent_date',
    'linked_grievance_id', 'disciplinary_paused_for_grievance',
    'status', 'closed_date', 'closed_reason',
  ];
  for (const key of settable) {
    if (key in data) {
      params.push(key === 'witnesses' || key === 'evidence_items'
        ? JSON.stringify(data[key]) : data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (fields.length === 0) return findDisciplinaryById(id, homeId, client);
  const { rows } = await conn.query(
    `UPDATE hr_disciplinary_cases SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING *`,
    params
  );
  return shapeDisc(rows[0]);
}

// ── Grievance Cases ─────────────────────────────────────────────────────────

function shapeGrv(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id, staff_id: row.staff_id,
    date_raised: d(row.date_raised), raised_by_method: row.raised_by_method,
    category: row.category, protected_characteristic: row.protected_characteristic,
    subject_summary: row.subject_summary, subject_detail: row.subject_detail,
    desired_outcome: row.desired_outcome,
    acknowledged_date: d(row.acknowledged_date), acknowledge_deadline: d(row.acknowledge_deadline),
    acknowledged_by: row.acknowledged_by,
    investigation_status: row.investigation_status, investigation_officer: row.investigation_officer,
    investigation_start_date: d(row.investigation_start_date), investigation_notes: row.investigation_notes,
    witnesses: row.witnesses || [], evidence_items: row.evidence_items || [],
    investigation_completed_date: d(row.investigation_completed_date),
    investigation_findings: row.investigation_findings,
    hearing_status: row.hearing_status, hearing_date: d(row.hearing_date),
    hearing_time: row.hearing_time, hearing_location: row.hearing_location,
    hearing_chair: row.hearing_chair, hearing_letter_sent_date: d(row.hearing_letter_sent_date),
    hearing_companion_name: row.hearing_companion_name, hearing_companion_role: row.hearing_companion_role,
    hearing_notes: row.hearing_notes, employee_statement_at_hearing: row.employee_statement_at_hearing,
    outcome: row.outcome, outcome_date: d(row.outcome_date), outcome_reason: row.outcome_reason,
    outcome_letter_sent_date: d(row.outcome_letter_sent_date),
    mediation_offered: row.mediation_offered, mediation_accepted: row.mediation_accepted,
    mediator_name: row.mediator_name,
    appeal_status: row.appeal_status, appeal_received_date: d(row.appeal_received_date),
    appeal_deadline: d(row.appeal_deadline), appeal_grounds: row.appeal_grounds,
    appeal_hearing_date: d(row.appeal_hearing_date), appeal_hearing_chair: row.appeal_hearing_chair,
    appeal_outcome: row.appeal_outcome, appeal_outcome_date: d(row.appeal_outcome_date),
    appeal_outcome_reason: row.appeal_outcome_reason,
    appeal_outcome_letter_sent_date: d(row.appeal_outcome_letter_sent_date),
    linked_disciplinary_id: row.linked_disciplinary_id, triggers_disciplinary: row.triggers_disciplinary,
    status: row.status, confidential: row.confidential,
    closed_date: d(row.closed_date), closed_reason: row.closed_reason,
    created_by: row.created_by, created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findGrievance(homeId, { staffId, status } = {}, client) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_grievance_cases WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  sql += ' ORDER BY date_raised DESC';
  const { rows } = await conn.query(sql, params);
  return rows.map(shapeGrv);
}

export async function findGrievanceById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_grievance_cases WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL', [id, homeId]);
  return shapeGrv(rows[0]);
}

export async function createGrievance(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_grievance_cases
       (home_id, staff_id, date_raised, raised_by_method, category, protected_characteristic,
        subject_summary, subject_detail, desired_outcome, status, confidential, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [homeId, data.staff_id, data.date_raised, data.raised_by_method, data.category,
     data.protected_characteristic || null, data.subject_summary,
     data.subject_detail || null, data.desired_outcome || null,
     data.status || 'open', data.confidential ?? true, data.created_by]
  );
  return shapeGrv(rows[0]);
}

export async function updateGrievance(id, homeId, data, client) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'acknowledged_date', 'acknowledge_deadline', 'acknowledged_by',
    'investigation_status', 'investigation_officer', 'investigation_start_date',
    'investigation_notes', 'witnesses', 'evidence_items', 'investigation_completed_date',
    'investigation_findings',
    'hearing_status', 'hearing_date', 'hearing_time', 'hearing_location',
    'hearing_chair', 'hearing_letter_sent_date', 'hearing_companion_name',
    'hearing_companion_role', 'hearing_notes', 'employee_statement_at_hearing',
    'outcome', 'outcome_date', 'outcome_reason', 'outcome_letter_sent_date',
    'mediation_offered', 'mediation_accepted', 'mediator_name',
    'appeal_status', 'appeal_received_date', 'appeal_deadline', 'appeal_grounds',
    'appeal_hearing_date', 'appeal_hearing_chair',
    'appeal_outcome', 'appeal_outcome_date', 'appeal_outcome_reason',
    'appeal_outcome_letter_sent_date',
    'linked_disciplinary_id', 'triggers_disciplinary',
    'status', 'confidential', 'closed_date', 'closed_reason',
  ];
  for (const key of settable) {
    if (key in data) {
      params.push(key === 'witnesses' || key === 'evidence_items'
        ? JSON.stringify(data[key]) : data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (fields.length === 0) return findGrievanceById(id, homeId, client);
  const { rows } = await conn.query(
    `UPDATE hr_grievance_cases SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING *`,
    params
  );
  return shapeGrv(rows[0]);
}

// ── Grievance Actions ───────────────────────────────────────────────────────

function shapeGrvAction(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id, grievance_id: row.grievance_id,
    description: row.description,
    responsible: row.responsible, due_date: d(row.due_date),
    completed_date: d(row.completed_date), status: row.status,
    created_at: ts(row.created_at),
  };
}

export async function findGrievanceActions(grievanceId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_grievance_actions WHERE grievance_id = $1 AND home_id = $2 ORDER BY created_at',
    [grievanceId, homeId]);
  return rows.map(shapeGrvAction);
}

export async function createGrievanceAction(grievanceId, homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_grievance_actions (grievance_id, home_id, description, responsible, due_date, status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [grievanceId, homeId, data.description, data.responsible || null,
     data.due_date || null, data.status || 'pending']
  );
  return shapeGrvAction(rows[0]);
}

export async function updateGrievanceAction(id, homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE hr_grievance_actions SET
       status = COALESCE($2, status), completed_date = COALESCE($3, completed_date),
       description = COALESCE($4, description), responsible = COALESCE($5, responsible),
       due_date = COALESCE($6, due_date)
     WHERE id = $1 AND home_id = $7 RETURNING *`,
    [id, data.status ?? null, data.completed_date ?? null,
     data.description ?? null, data.responsible ?? null, data.due_date ?? null, homeId]
  );
  return shapeGrvAction(rows[0]);
}

// ── Performance Cases ───────────────────────────────────────────────────────

function shapePerf(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id, staff_id: row.staff_id, type: row.type,
    date_raised: d(row.date_raised), raised_by: row.raised_by,
    concern_summary: row.concern_summary, concern_detail: row.concern_detail,
    performance_area: row.performance_area,
    informal_discussion_date: d(row.informal_discussion_date),
    informal_discussion_notes: row.informal_discussion_notes,
    informal_targets: row.informal_targets || [],
    informal_review_date: d(row.informal_review_date), informal_outcome: row.informal_outcome,
    pip_start_date: d(row.pip_start_date), pip_end_date: d(row.pip_end_date),
    pip_objectives: row.pip_objectives || [],
    pip_overall_outcome: row.pip_overall_outcome, pip_extended_to: d(row.pip_extended_to),
    hearing_status: row.hearing_status, hearing_date: d(row.hearing_date),
    hearing_time: row.hearing_time, hearing_location: row.hearing_location,
    hearing_chair: row.hearing_chair, hearing_letter_sent_date: d(row.hearing_letter_sent_date),
    hearing_companion_name: row.hearing_companion_name, hearing_companion_role: row.hearing_companion_role,
    hearing_notes: row.hearing_notes,
    outcome: row.outcome, outcome_date: d(row.outcome_date), outcome_reason: row.outcome_reason,
    outcome_letter_sent_date: d(row.outcome_letter_sent_date), warning_expiry_date: d(row.warning_expiry_date),
    redeployment_offered: row.redeployment_offered, redeployment_role: row.redeployment_role,
    redeployment_accepted: row.redeployment_accepted,
    appeal_status: row.appeal_status, appeal_received_date: d(row.appeal_received_date),
    appeal_deadline: d(row.appeal_deadline), appeal_grounds: row.appeal_grounds,
    appeal_hearing_date: d(row.appeal_hearing_date),
    appeal_outcome: row.appeal_outcome, appeal_outcome_date: d(row.appeal_outcome_date),
    appeal_outcome_reason: row.appeal_outcome_reason,
    status: row.status, closed_date: d(row.closed_date),
    created_by: row.created_by, created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findPerformance(homeId, { staffId, status } = {}, client) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_performance_cases WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  sql += ' ORDER BY date_raised DESC';
  const { rows } = await conn.query(sql, params);
  return rows.map(shapePerf);
}

export async function findPerformanceById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_performance_cases WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL', [id, homeId]);
  return shapePerf(rows[0]);
}

export async function createPerformance(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_performance_cases
       (home_id, staff_id, type, date_raised, raised_by, concern_summary,
        concern_detail, performance_area, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [homeId, data.staff_id, data.type, data.date_raised, data.raised_by,
     data.concern_summary, data.concern_detail || null, data.performance_area,
     data.status || 'open', data.created_by]
  );
  return shapePerf(rows[0]);
}

export async function updatePerformance(id, homeId, data, client) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'informal_discussion_date', 'informal_discussion_notes', 'informal_targets',
    'informal_review_date', 'informal_outcome',
    'pip_start_date', 'pip_end_date', 'pip_objectives', 'pip_overall_outcome', 'pip_extended_to',
    'hearing_status', 'hearing_date', 'hearing_time', 'hearing_location',
    'hearing_chair', 'hearing_letter_sent_date', 'hearing_companion_name',
    'hearing_companion_role', 'hearing_notes',
    'outcome', 'outcome_date', 'outcome_reason', 'outcome_letter_sent_date', 'warning_expiry_date',
    'redeployment_offered', 'redeployment_role', 'redeployment_accepted',
    'appeal_status', 'appeal_received_date', 'appeal_deadline', 'appeal_grounds',
    'appeal_hearing_date', 'appeal_outcome', 'appeal_outcome_date', 'appeal_outcome_reason',
    'status', 'closed_date',
  ];
  const jsonFields = ['informal_targets', 'pip_objectives'];
  for (const key of settable) {
    if (key in data) {
      params.push(jsonFields.includes(key) ? JSON.stringify(data[key]) : data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (fields.length === 0) return findPerformanceById(id, homeId, client);
  const { rows } = await conn.query(
    `UPDATE hr_performance_cases SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING *`,
    params
  );
  return shapePerf(rows[0]);
}

// ── RTW Interviews ──────────────────────────────────────────────────────────

function shapeRtw(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id, staff_id: row.staff_id,
    absence_start_date: d(row.absence_start_date), absence_end_date: d(row.absence_end_date),
    absence_days: row.absence_days != null ? parseInt(row.absence_days, 10) : null, absence_reason: row.absence_reason,
    rtw_date: d(row.rtw_date), rtw_conducted_by: row.rtw_conducted_by,
    fit_to_return: row.fit_to_return, adjustments_needed: row.adjustments_needed,
    adjustments_detail: row.adjustments_detail, underlying_condition: row.underlying_condition,
    oh_referral_recommended: row.oh_referral_recommended, follow_up_date: d(row.follow_up_date),
    notes: row.notes,
    fit_note_received: row.fit_note_received, fit_note_date: d(row.fit_note_date),
    fit_note_type: row.fit_note_type, fit_note_adjustments: row.fit_note_adjustments,
    fit_note_review_date: d(row.fit_note_review_date),
    bradford_score_after: row.bradford_score_after != null ? parseFloat(row.bradford_score_after) : null, trigger_reached: row.trigger_reached,
    action_taken: row.action_taken, linked_case_id: row.linked_case_id,
    created_by: row.created_by, created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findRtwInterviews(homeId, { staffId } = {}, client) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_rtw_interviews WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  sql += ' ORDER BY rtw_date DESC';
  const { rows } = await conn.query(sql, params);
  return rows.map(shapeRtw);
}

export async function createRtwInterview(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_rtw_interviews
       (home_id, staff_id, absence_start_date, absence_end_date, absence_days, absence_reason,
        rtw_date, rtw_conducted_by, fit_to_return, adjustments_needed, adjustments_detail,
        underlying_condition, oh_referral_recommended, notes,
        fit_note_received, fit_note_date, fit_note_type, fit_note_adjustments,
        bradford_score_after, trigger_reached, action_taken, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
    [homeId, data.staff_id, data.absence_start_date, data.absence_end_date || null,
     data.absence_days || null, data.absence_reason || null,
     data.rtw_date, data.rtw_conducted_by, data.fit_to_return ?? true,
     data.adjustments_needed ?? false, data.adjustments_detail || null,
     data.underlying_condition ?? false, data.oh_referral_recommended ?? false,
     data.notes || null, data.fit_note_received ?? false, data.fit_note_date || null,
     data.fit_note_type || null, data.fit_note_adjustments || null,
     data.bradford_score_after || null, data.trigger_reached || null, data.action_taken || null,
     data.created_by || null]
  );
  return shapeRtw(rows[0]);
}

export async function updateRtwInterview(id, homeId, data, client) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'absence_end_date', 'absence_days', 'absence_reason', 'fit_to_return',
    'adjustments_needed', 'adjustments_detail', 'underlying_condition',
    'oh_referral_recommended', 'follow_up_date', 'notes',
    'fit_note_received', 'fit_note_date', 'fit_note_type', 'fit_note_adjustments',
    'fit_note_review_date', 'bradford_score_after', 'trigger_reached',
    'action_taken', 'linked_case_id',
  ];
  for (const key of settable) {
    if (key in data) { params.push(data[key] ?? null); fields.push(`${key} = $${params.length}`); }
  }
  if (fields.length === 0) return null;
  const { rows } = await conn.query(
    `UPDATE hr_rtw_interviews SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING *`,
    params
  );
  return shapeRtw(rows[0]);
}

// ── OH Referrals ────────────────────────────────────────────────────────────

function shapeOh(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id, staff_id: row.staff_id,
    referral_date: d(row.referral_date), referred_by: row.referred_by,
    reason: row.reason, questions_for_oh: row.questions_for_oh || [],
    employee_consent_obtained: row.employee_consent_obtained, consent_date: d(row.consent_date),
    oh_provider: row.oh_provider, appointment_date: d(row.appointment_date),
    report_received_date: d(row.report_received_date), report_summary: row.report_summary,
    fit_for_role: row.fit_for_role, adjustments_recommended: row.adjustments_recommended,
    estimated_return_date: d(row.estimated_return_date), disability_likely: row.disability_likely,
    follow_up_date: d(row.follow_up_date), adjustments_implemented: row.adjustments_implemented || [],
    status: row.status,
    created_by: row.created_by, created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findOhReferrals(homeId, { staffId, status } = {}, client) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_oh_referrals WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  sql += ' ORDER BY referral_date DESC';
  const { rows } = await conn.query(sql, params);
  return rows.map(shapeOh);
}

export async function createOhReferral(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_oh_referrals
       (home_id, staff_id, referral_date, referred_by, reason, questions_for_oh,
        employee_consent_obtained, consent_date, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [homeId, data.staff_id, data.referral_date, data.referred_by,
     data.reason, JSON.stringify(data.questions_for_oh || []),
     data.employee_consent_obtained ?? false, data.consent_date || null,
     data.status || 'pending', data.created_by || null]
  );
  return shapeOh(rows[0]);
}

export async function updateOhReferral(id, homeId, data, client) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'employee_consent_obtained', 'consent_date', 'oh_provider', 'appointment_date', 'status',
    'report_received_date', 'report_summary', 'fit_for_role', 'adjustments_recommended',
    'estimated_return_date', 'disability_likely', 'follow_up_date', 'adjustments_implemented',
    'questions_for_oh',
  ];
  const jsonFields = ['questions_for_oh', 'adjustments_implemented'];
  for (const key of settable) {
    if (key in data) {
      params.push(jsonFields.includes(key) ? JSON.stringify(data[key]) : data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (fields.length === 0) return null;
  const { rows } = await conn.query(
    `UPDATE hr_oh_referrals SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING *`,
    params
  );
  return shapeOh(rows[0]);
}

// ── Contracts ───────────────────────────────────────────────────────────────

function shapeContract(row) {
  if (!row) return null;
  const f = v => v != null ? parseFloat(v) : null;
  return {
    id: row.id, home_id: row.home_id, staff_id: row.staff_id,
    statement_issued: row.statement_issued, statement_issued_date: d(row.statement_issued_date),
    contract_type: row.contract_type, contract_start_date: d(row.contract_start_date),
    contract_end_date: d(row.contract_end_date),
    job_title: row.job_title, job_description_ref: row.job_description_ref,
    reporting_to: row.reporting_to, place_of_work: row.place_of_work,
    hours_per_week: f(row.hours_per_week), working_pattern: row.working_pattern,
    hourly_rate: f(row.hourly_rate), pay_frequency: row.pay_frequency,
    annual_leave_days: row.annual_leave_days,
    notice_period_employer: row.notice_period_employer, notice_period_employee: row.notice_period_employee,
    probation_period_months: row.probation_period_months,
    probation_start_date: d(row.probation_start_date), probation_end_date: d(row.probation_end_date),
    probation_reviews: row.probation_reviews || [],
    probation_outcome: row.probation_outcome, probation_extension_date: d(row.probation_extension_date),
    probation_extension_reason: row.probation_extension_reason,
    probation_confirmed_date: d(row.probation_confirmed_date),
    probation_confirmation_letter_sent: row.probation_confirmation_letter_sent,
    variations: row.variations || [],
    termination_type: row.termination_type, termination_date: d(row.termination_date),
    termination_reason: row.termination_reason, notice_given_date: d(row.notice_given_date),
    notice_given_by: row.notice_given_by, last_working_day: d(row.last_working_day),
    garden_leave: row.garden_leave, pilon: row.pilon,
    exit_interview_date: d(row.exit_interview_date), exit_interview_notes: row.exit_interview_notes,
    references_agreed: row.references_agreed,
    status: row.status, created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findContracts(homeId, { staffId, status } = {}, client) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_contracts WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  sql += ' ORDER BY contract_start_date DESC';
  const { rows } = await conn.query(sql, params);
  return rows.map(shapeContract);
}

export async function findContractById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_contracts WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL', [id, homeId]);
  return shapeContract(rows[0]);
}

export async function createContract(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_contracts
       (home_id, staff_id, statement_issued, statement_issued_date, contract_type,
        contract_start_date, contract_end_date, job_title, reporting_to, place_of_work,
        hours_per_week, working_pattern, hourly_rate, pay_frequency, annual_leave_days,
        notice_period_employer, notice_period_employee,
        probation_period_months, probation_start_date, probation_end_date, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
    [homeId, data.staff_id, data.statement_issued ?? false,
     data.statement_issued_date || null, data.contract_type,
     data.contract_start_date, data.contract_end_date || null,
     data.job_title || null, data.reporting_to || null, data.place_of_work || null,
     data.hours_per_week || null, data.working_pattern || null,
     data.hourly_rate || null, data.pay_frequency || null, data.annual_leave_days || 28,
     data.notice_period_employer || null, data.notice_period_employee || null,
     data.probation_period_months || null, data.probation_start_date || null,
     data.probation_end_date || null, data.status || 'active']
  );
  return shapeContract(rows[0]);
}

export async function updateContract(id, homeId, data, client) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'statement_issued', 'statement_issued_date', 'contract_type', 'contract_end_date',
    'job_title', 'job_description_ref', 'reporting_to', 'place_of_work',
    'hours_per_week', 'working_pattern', 'hourly_rate', 'pay_frequency', 'annual_leave_days',
    'notice_period_employer', 'notice_period_employee',
    'probation_period_months', 'probation_end_date', 'probation_reviews',
    'probation_outcome', 'probation_extension_date', 'probation_extension_reason',
    'probation_confirmed_date', 'probation_confirmation_letter_sent',
    'variations',
    'termination_type', 'termination_date', 'termination_reason', 'notice_given_date',
    'notice_given_by', 'last_working_day', 'garden_leave', 'pilon',
    'exit_interview_date', 'exit_interview_notes', 'references_agreed', 'status',
  ];
  const jsonFields = ['probation_reviews', 'variations'];
  for (const key of settable) {
    if (key in data) {
      params.push(jsonFields.includes(key) ? JSON.stringify(data[key]) : data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (fields.length === 0) return findContractById(id, homeId, client);
  const { rows } = await conn.query(
    `UPDATE hr_contracts SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING *`,
    params
  );
  return shapeContract(rows[0]);
}

// ── Family Leave ────────────────────────────────────────────────────────────

function shapeFamilyLeave(row) {
  if (!row) return null;
  const f = v => v != null ? parseFloat(v) : null;
  return {
    id: row.id, home_id: row.home_id, staff_id: row.staff_id, type: row.type,
    request_date: d(row.request_date),
    expected_due_date: d(row.expected_due_date), actual_birth_date: d(row.actual_birth_date),
    mat_b1_received: row.mat_b1_received, mat_b1_date: d(row.mat_b1_date),
    paternity_week_choice: row.paternity_week_choice, paternity_start_date: d(row.paternity_start_date),
    spl_total_weeks: row.spl_total_weeks, spl_notice_received_date: d(row.spl_notice_received_date),
    spl_partner_employer: row.spl_partner_employer, spl_booking_notices: row.spl_booking_notices || [],
    matching_date: d(row.matching_date), placement_date: d(row.placement_date),
    upl_child_name: row.upl_child_name, upl_child_dob: d(row.upl_child_dob),
    upl_weeks_requested: row.upl_weeks_requested, upl_weeks_used_total: row.upl_weeks_used_total,
    bereavement_date: d(row.bereavement_date), bereavement_relationship: row.bereavement_relationship,
    leave_start_date: d(row.leave_start_date), leave_end_date: d(row.leave_end_date),
    expected_return_date: d(row.expected_return_date), actual_return_date: d(row.actual_return_date),
    statutory_pay_type: row.statutory_pay_type, statutory_pay_start_date: d(row.statutory_pay_start_date),
    enhanced_pay: row.enhanced_pay, enhanced_pay_weeks: row.enhanced_pay_weeks,
    enhanced_pay_rate: f(row.enhanced_pay_rate),
    risk_assessment_date: d(row.risk_assessment_date), risk_assessment_by: row.risk_assessment_by,
    risks_identified: row.risks_identified, adjustments_made: row.adjustments_made,
    risk_assessment_review_date: d(row.risk_assessment_review_date),
    kit_days: row.kit_days || [], split_days: row.split_days || [],
    return_confirmed: row.return_confirmed, return_pattern: row.return_pattern,
    flexible_working_request_linked: row.flexible_working_request_linked,
    protected_period_start: d(row.protected_period_start), protected_period_end: d(row.protected_period_end),
    status: row.status, notes: row.notes,
    created_by: row.created_by, created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findFamilyLeave(homeId, { staffId, type } = {}, client) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_family_leave WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (type) { params.push(type); sql += ` AND type = $${params.length}`; }
  sql += ' ORDER BY request_date DESC NULLS LAST';
  const { rows } = await conn.query(sql, params);
  return rows.map(shapeFamilyLeave);
}

export async function findFamilyLeaveById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_family_leave WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL', [id, homeId]);
  return shapeFamilyLeave(rows[0]);
}

export async function createFamilyLeave(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_family_leave
       (home_id, staff_id, type, request_date, leave_start_date, leave_end_date,
        expected_return_date, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [homeId, data.staff_id, data.type, data.request_date || null,
     data.leave_start_date || null, data.leave_end_date || null,
     data.expected_return_date || null, data.status || 'requested',
     data.notes || null, data.created_by || null]
  );
  return shapeFamilyLeave(rows[0]);
}

export async function updateFamilyLeave(id, homeId, data, client) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'request_date', 'expected_due_date', 'actual_birth_date', 'mat_b1_received', 'mat_b1_date',
    'paternity_week_choice', 'paternity_start_date',
    'spl_total_weeks', 'spl_notice_received_date', 'spl_partner_employer', 'spl_booking_notices',
    'matching_date', 'placement_date',
    'upl_child_name', 'upl_child_dob', 'upl_weeks_requested', 'upl_weeks_used_total',
    'bereavement_date', 'bereavement_relationship',
    'leave_start_date', 'leave_end_date', 'expected_return_date', 'actual_return_date',
    'statutory_pay_type', 'statutory_pay_start_date', 'enhanced_pay', 'enhanced_pay_weeks', 'enhanced_pay_rate',
    'risk_assessment_date', 'risk_assessment_by', 'risks_identified', 'adjustments_made',
    'risk_assessment_review_date', 'kit_days', 'split_days',
    'return_confirmed', 'return_pattern', 'flexible_working_request_linked',
    'protected_period_start', 'protected_period_end', 'status', 'notes',
  ];
  const jsonFields = ['spl_booking_notices', 'kit_days', 'split_days'];
  for (const key of settable) {
    if (key in data) {
      params.push(jsonFields.includes(key) ? JSON.stringify(data[key]) : data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (fields.length === 0) return findFamilyLeaveById(id, homeId, client);
  const { rows } = await conn.query(
    `UPDATE hr_family_leave SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING *`,
    params
  );
  return shapeFamilyLeave(rows[0]);
}

// ── Flexible Working ────────────────────────────────────────────────────────

function shapeFlex(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id, staff_id: row.staff_id,
    request_date: d(row.request_date), effective_date_requested: d(row.effective_date_requested),
    current_pattern: row.current_pattern, requested_change: row.requested_change,
    reason: row.reason, employee_assessment_of_impact: row.employee_assessment_of_impact,
    decision_deadline: d(row.decision_deadline), meeting_date: d(row.meeting_date),
    meeting_notes: row.meeting_notes,
    decision: row.decision, decision_date: d(row.decision_date), decision_by: row.decision_by,
    refusal_reason: row.refusal_reason, refusal_explanation: row.refusal_explanation,
    approved_pattern: row.approved_pattern, approved_effective_date: d(row.approved_effective_date),
    trial_period: row.trial_period, trial_period_end: d(row.trial_period_end),
    contract_variation_id: row.contract_variation_id,
    appeal_date: d(row.appeal_date), appeal_grounds: row.appeal_grounds,
    appeal_outcome: row.appeal_outcome, appeal_outcome_date: d(row.appeal_outcome_date),
    status: row.status, notes: row.notes,
    created_by: row.created_by, created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findFlexWorking(homeId, { staffId, status } = {}, client) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_flexible_working WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  sql += ' ORDER BY request_date DESC';
  const { rows } = await conn.query(sql, params);
  return rows.map(shapeFlex);
}

export async function findFlexWorkingById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_flexible_working WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL', [id, homeId]);
  return shapeFlex(rows[0]);
}

export async function createFlexWorking(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_flexible_working
       (home_id, staff_id, request_date, effective_date_requested, current_pattern,
        requested_change, reason, employee_assessment_of_impact, decision_deadline, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [homeId, data.staff_id, data.request_date, data.effective_date_requested || null,
     data.current_pattern || null, data.requested_change, data.reason || null,
     data.employee_assessment_of_impact || null, data.decision_deadline,
     data.status || 'pending', data.created_by || null]
  );
  return shapeFlex(rows[0]);
}

export async function updateFlexWorking(id, homeId, data, client) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'meeting_date', 'meeting_notes', 'decision', 'decision_date', 'decision_by',
    'refusal_reason', 'refusal_explanation',
    'approved_pattern', 'approved_effective_date', 'trial_period', 'trial_period_end',
    'contract_variation_id',
    'appeal_date', 'appeal_grounds', 'appeal_outcome', 'appeal_outcome_date',
    'status', 'notes',
  ];
  for (const key of settable) {
    if (key in data) { params.push(data[key] ?? null); fields.push(`${key} = $${params.length}`); }
  }
  if (fields.length === 0) return findFlexWorkingById(id, homeId, client);
  const { rows } = await conn.query(
    `UPDATE hr_flexible_working SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING *`,
    params
  );
  return shapeFlex(rows[0]);
}

// ── EDI Records ─────────────────────────────────────────────────────────────

function shapeEdi(row) {
  if (!row) return null;
  const f = v => v != null ? parseFloat(v) : null;
  return {
    id: row.id, home_id: row.home_id, record_type: row.record_type, staff_id: row.staff_id,
    complaint_date: d(row.complaint_date), harassment_category: row.harassment_category,
    third_party: row.third_party, third_party_type: row.third_party_type,
    respondent_type: row.respondent_type, respondent_staff_id: row.respondent_staff_id,
    respondent_name: row.respondent_name,
    handling_route: row.handling_route, linked_case_id: row.linked_case_id,
    reasonable_steps_evidence: row.reasonable_steps_evidence || [],
    condition_description: row.condition_description, adjustments: row.adjustments || [],
    oh_referral_id: row.oh_referral_id,
    access_to_work_applied: row.access_to_work_applied,
    access_to_work_reference: row.access_to_work_reference,
    access_to_work_amount: f(row.access_to_work_amount),
    description: row.description, status: row.status, outcome: row.outcome, notes: row.notes,
    created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findEdi(homeId, { recordType, staffId } = {}, client) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_edi_records WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (recordType) { params.push(recordType); sql += ` AND record_type = $${params.length}`; }
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  const { rows } = await conn.query(sql, params);
  return rows.map(shapeEdi);
}

export async function findEdiById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_edi_records WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL', [id, homeId]);
  return shapeEdi(rows[0]);
}

export async function createEdi(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_edi_records
       (home_id, record_type, staff_id, complaint_date, harassment_category,
        third_party, third_party_type, respondent_type, respondent_staff_id, respondent_name,
        handling_route, condition_description, adjustments, description, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [homeId, data.record_type, data.staff_id || null, data.complaint_date || null,
     data.harassment_category || null, data.third_party ?? false,
     data.third_party_type || null, data.respondent_type || null,
     data.respondent_staff_id || null, data.respondent_name || null,
     data.handling_route || null, data.condition_description || null,
     JSON.stringify(data.adjustments || []), data.description || null,
     data.status || 'open']
  );
  return shapeEdi(rows[0]);
}

export async function updateEdi(id, homeId, data, client) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'harassment_category', 'third_party', 'third_party_type',
    'respondent_type', 'respondent_staff_id', 'respondent_name',
    'handling_route', 'linked_case_id', 'reasonable_steps_evidence',
    'condition_description', 'adjustments', 'oh_referral_id',
    'access_to_work_applied', 'access_to_work_reference', 'access_to_work_amount',
    'description', 'status', 'outcome', 'notes',
  ];
  const jsonFields = ['reasonable_steps_evidence', 'adjustments'];
  for (const key of settable) {
    if (key in data) {
      params.push(jsonFields.includes(key) ? JSON.stringify(data[key]) : data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (fields.length === 0) return findEdiById(id, homeId, client);
  const { rows } = await conn.query(
    `UPDATE hr_edi_records SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING *`,
    params
  );
  return shapeEdi(rows[0]);
}

// ── TUPE Transfers ──────────────────────────────────────────────────────────

function shapeTupe(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id,
    transfer_type: row.transfer_type, transfer_date: d(row.transfer_date),
    transferor_name: row.transferor_name, transferee_name: row.transferee_name,
    employees: row.employees || [],
    consultation_start_date: d(row.consultation_start_date),
    consultation_end_date: d(row.consultation_end_date),
    measures_letter_date: d(row.measures_letter_date), measures_description: row.measures_description,
    employee_reps_consulted: row.employee_reps_consulted, rep_names: row.rep_names,
    eli_received_date: d(row.eli_received_date), eli_complete: row.eli_complete,
    eli_items: row.eli_items || {},
    dd_notes: row.dd_notes, outstanding_claims: row.outstanding_claims,
    outstanding_tribunal_claims: row.outstanding_tribunal_claims,
    status: row.status, notes: row.notes,
    created_by: row.created_by, created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findTupe(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_tupe_transfers WHERE home_id = $1 AND deleted_at IS NULL ORDER BY transfer_date DESC',
    [homeId]
  );
  return rows.map(shapeTupe);
}

export async function findTupeById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_tupe_transfers WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL', [id, homeId]);
  return shapeTupe(rows[0]);
}

export async function createTupe(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_tupe_transfers
       (home_id, transfer_type, transfer_date, transferor_name, transferee_name,
        employees, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [homeId, data.transfer_type, data.transfer_date,
     data.transferor_name, data.transferee_name,
     JSON.stringify(data.employees || []), data.status || 'planned',
     data.notes || null, data.created_by || null]
  );
  return shapeTupe(rows[0]);
}

export async function updateTupe(id, homeId, data, client) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'transfer_date', 'transferor_name', 'transferee_name', 'employees',
    'consultation_start_date', 'consultation_end_date', 'measures_letter_date',
    'measures_description', 'employee_reps_consulted', 'rep_names',
    'eli_received_date', 'eli_complete', 'eli_items',
    'dd_notes', 'outstanding_claims', 'outstanding_tribunal_claims', 'status', 'notes',
  ];
  const jsonFields = ['employees', 'eli_items'];
  for (const key of settable) {
    if (key in data) {
      params.push(jsonFields.includes(key) ? JSON.stringify(data[key]) : data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  if (fields.length === 0) return findTupeById(id, homeId, client);
  const { rows } = await conn.query(
    `UPDATE hr_tupe_transfers SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING *`,
    params
  );
  return shapeTupe(rows[0]);
}

// ── RTW & DBS Renewals ──────────────────────────────────────────────────────

function shapeRenewal(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id, staff_id: row.staff_id, check_type: row.check_type,
    dbs_certificate_number: row.dbs_certificate_number, dbs_disclosure_level: row.dbs_disclosure_level,
    dbs_check_date: d(row.dbs_check_date), dbs_next_renewal_due: d(row.dbs_next_renewal_due),
    dbs_update_service_registered: row.dbs_update_service_registered,
    dbs_update_service_last_checked: d(row.dbs_update_service_last_checked),
    dbs_barred_list_check: row.dbs_barred_list_check,
    rtw_document_type: row.rtw_document_type, rtw_check_date: d(row.rtw_check_date),
    rtw_document_expiry: d(row.rtw_document_expiry), rtw_next_check_due: d(row.rtw_next_check_due),
    status: row.status, checked_by: row.checked_by, notes: row.notes,
    created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findRenewals(homeId, { staffId, checkType } = {}, client) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_rtw_dbs_renewals WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (checkType) { params.push(checkType); sql += ` AND check_type = $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  const { rows } = await conn.query(sql, params);
  return rows.map(shapeRenewal);
}

export async function findRenewalById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_rtw_dbs_renewals WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL', [id, homeId]);
  return shapeRenewal(rows[0]);
}

export async function createRenewal(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_rtw_dbs_renewals
       (home_id, staff_id, check_type,
        dbs_certificate_number, dbs_disclosure_level, dbs_check_date, dbs_next_renewal_due,
        dbs_update_service_registered, dbs_barred_list_check,
        rtw_document_type, rtw_check_date, rtw_document_expiry, rtw_next_check_due,
        status, checked_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [homeId, data.staff_id, data.check_type,
     data.dbs_certificate_number || null, data.dbs_disclosure_level || null,
     data.dbs_check_date || null, data.dbs_next_renewal_due || null,
     data.dbs_update_service_registered ?? false, data.dbs_barred_list_check ?? true,
     data.rtw_document_type || null, data.rtw_check_date || null,
     data.rtw_document_expiry || null, data.rtw_next_check_due || null,
     data.status || 'current', data.checked_by || null, data.notes || null]
  );
  return shapeRenewal(rows[0]);
}

export async function updateRenewal(id, homeId, data, client) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'dbs_certificate_number', 'dbs_disclosure_level', 'dbs_check_date', 'dbs_next_renewal_due',
    'dbs_update_service_registered', 'dbs_update_service_last_checked', 'dbs_barred_list_check',
    'rtw_document_type', 'rtw_check_date', 'rtw_document_expiry', 'rtw_next_check_due',
    'status', 'checked_by', 'notes',
  ];
  for (const key of settable) {
    if (key in data) { params.push(data[key] ?? null); fields.push(`${key} = $${params.length}`); }
  }
  if (fields.length === 0) return findRenewalById(id, homeId, client);
  const { rows } = await conn.query(
    `UPDATE hr_rtw_dbs_renewals SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING *`,
    params
  );
  return shapeRenewal(rows[0]);
}

// ── Case Notes (shared across all HR case types) ────────────────────────────

function shapeNote(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id, case_type: row.case_type, case_id: row.case_id,
    note_type: row.note_type, content: row.content, author: row.author,
    created_at: ts(row.created_at),
  };
}

export async function findCaseNotes(homeId, caseType, caseId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_case_notes WHERE home_id = $1 AND case_type = $2 AND case_id = $3 ORDER BY created_at DESC',
    [homeId, caseType, caseId]
  );
  return rows.map(shapeNote);
}

export async function createCaseNote(homeId, caseType, caseId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_case_notes (home_id, case_type, case_id, note_type, content, author)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [homeId, caseType, caseId, data.note_type || 'note', data.content, data.author]
  );
  return shapeNote(rows[0]);
}

// ── Warning Register (calculated view) ──────────────────────────────────────

export async function getActiveWarnings(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT staff_id, outcome AS warning_level, warning_expiry_date, id AS case_id,
            'disciplinary' AS case_type, date_raised
     FROM hr_disciplinary_cases
     WHERE home_id = $1 AND deleted_at IS NULL
       AND outcome IN ('verbal_warning','first_written','final_written')
       AND warning_expiry_date > CURRENT_DATE
       AND status != 'withdrawn'
     UNION ALL
     SELECT staff_id, outcome AS warning_level, warning_expiry_date, id AS case_id,
            'performance' AS case_type, date_raised
     FROM hr_performance_cases
     WHERE home_id = $1 AND deleted_at IS NULL
       AND outcome IN ('first_written','final_written')
       AND warning_expiry_date > CURRENT_DATE
       AND status != 'closed'
     ORDER BY warning_expiry_date DESC`,
    [homeId]
  );
  return rows.map(r => ({
    staff_id: r.staff_id,
    warning_level: r.warning_level,
    warning_expiry_date: d(r.warning_expiry_date),
    case_id: r.case_id,
    case_type: r.case_type,
    date_raised: d(r.date_raised),
  }));
}

// ── HR Stats (dashboard KPIs) ───────────────────────────────────────────────

export async function getHrStats(homeId, client) {
  const conn = client || pool;
  const [disc, grv, perf, warnings, flex] = await Promise.all([
    conn.query(
      `SELECT status, COUNT(*) as c FROM hr_disciplinary_cases
       WHERE home_id = $1 AND deleted_at IS NULL AND status NOT IN ('closed','withdrawn')
       GROUP BY status`, [homeId]),
    conn.query(
      `SELECT status, COUNT(*) as c FROM hr_grievance_cases
       WHERE home_id = $1 AND deleted_at IS NULL AND status NOT IN ('closed','withdrawn')
       GROUP BY status`, [homeId]),
    conn.query(
      `SELECT status, COUNT(*) as c FROM hr_performance_cases
       WHERE home_id = $1 AND deleted_at IS NULL AND status != 'closed'
       GROUP BY status`, [homeId]),
    getActiveWarnings(homeId, conn),
    conn.query(
      `SELECT COUNT(*) as c FROM hr_flexible_working
       WHERE home_id = $1 AND deleted_at IS NULL AND decision IS NULL
         AND decision_deadline <= CURRENT_DATE + INTERVAL '14 days'`, [homeId]),
  ]);
  return {
    disciplinary_open: disc.rows.reduce((s, r) => s + parseInt(r.c), 0),
    grievance_open: grv.rows.reduce((s, r) => s + parseInt(r.c), 0),
    performance_open: perf.rows.reduce((s, r) => s + parseInt(r.c), 0),
    active_warnings: warnings.length,
    flex_working_pending: parseInt(flex.rows[0]?.c || 0),
  };
}

// ── File Attachments ────────────────────────────────────────────────────────

function shapeAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    home_id: row.home_id,
    case_type: row.case_type,
    case_id: row.case_id,
    original_name: row.original_name,
    stored_name: row.stored_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    description: row.description,
    uploaded_by: row.uploaded_by,
    created_at: ts(row.created_at),
  };
}

export async function findAttachments(caseType, caseId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_file_attachments WHERE case_type = $1 AND case_id = $2 AND home_id = $3 ORDER BY created_at DESC',
    [caseType, caseId, homeId]
  );
  return rows.map(shapeAttachment);
}

export async function findAttachmentById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_file_attachments WHERE id = $1 AND home_id = $2',
    [id, homeId]
  );
  return shapeAttachment(rows[0]);
}

export async function createAttachment(homeId, caseType, caseId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_file_attachments (home_id, case_type, case_id, original_name, stored_name, mime_type, size_bytes, description, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [homeId, caseType, caseId, data.original_name, data.stored_name, data.mime_type, data.size_bytes, data.description || null, data.uploaded_by]
  );
  return shapeAttachment(rows[0]);
}

export async function deleteAttachment(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'DELETE FROM hr_file_attachments WHERE id = $1 AND home_id = $2 RETURNING *',
    [id, homeId]
  );
  return shapeAttachment(rows[0]);
}

// ── Investigation Meetings ──────────────────────────────────────────────────

function shapeMeeting(row) {
  if (!row) return null;
  return {
    id: row.id,
    home_id: row.home_id,
    case_type: row.case_type,
    case_id: row.case_id,
    meeting_date: d(row.meeting_date),
    meeting_time: row.meeting_time,
    meeting_type: row.meeting_type,
    location: row.location,
    attendees: row.attendees || [],
    summary: row.summary,
    key_points: row.key_points,
    outcome: row.outcome,
    recorded_by: row.recorded_by,
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

export async function findMeetings(caseType, caseId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_investigation_meetings WHERE case_type = $1 AND case_id = $2 AND home_id = $3 ORDER BY meeting_date DESC, created_at DESC',
    [caseType, caseId, homeId]
  );
  return rows.map(shapeMeeting);
}

export async function createMeeting(homeId, caseType, caseId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_investigation_meetings (home_id, case_type, case_id, meeting_date, meeting_time, meeting_type, location, attendees, summary, key_points, outcome, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [homeId, caseType, caseId, data.meeting_date, data.meeting_time || null, data.meeting_type || 'interview', data.location || null,
     JSON.stringify(data.attendees || []), data.summary || null, data.key_points || null, data.outcome || null, data.recorded_by]
  );
  return shapeMeeting(rows[0]);
}

export async function updateMeeting(id, homeId, data, client) {
  const conn = client || pool;
  const fields = [];
  const vals = [];
  let n = 1;
  for (const key of ['meeting_date','meeting_time','meeting_type','location','summary','key_points','outcome']) {
    if (data[key] !== undefined) { fields.push(`${key} = $${n}`); vals.push(data[key]); n++; }
  }
  if (data.attendees !== undefined) { fields.push(`attendees = $${n}`); vals.push(JSON.stringify(data.attendees)); n++; }
  if (fields.length === 0) return null;
  vals.push(id, homeId);
  const { rows } = await conn.query(
    `UPDATE hr_investigation_meetings SET ${fields.join(', ')} WHERE id = $${n} AND home_id = $${n + 1} RETURNING *`,
    vals
  );
  return shapeMeeting(rows[0]);
}
