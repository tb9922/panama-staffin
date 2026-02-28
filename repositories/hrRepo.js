import { pool } from '../db.js';

function d(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : v; }
function ts(v) { return v instanceof Date ? v.toISOString() : v; }

// ── Shape Factory ────────────────────────────────────────────────────────────
// Builds a row → API-object shaper from a declarative config.
// fields = explicit whitelist (security boundary — only listed fields reach the frontend)
// dates/timestamps/jsonArrays/jsonObjects/ints/floats = transformation sets
// aliases = { frontendName: 'dbField' | (row, out) => value }
function createShaper({ fields, dates, timestamps, jsonArrays, jsonObjects, ints, floats, aliases }) {
  const dateSet  = new Set(dates || []);
  const tsSet    = new Set(timestamps || ['created_at', 'updated_at']);
  const arrSet   = new Set(jsonArrays || []);
  const objSet   = new Set(jsonObjects || []);
  const intSet   = new Set(ints || []);
  const floatSet = new Set(floats || []);

  return function shape(row) {
    if (!row) return null;
    const out = {};
    for (const key of fields) {
      const v = row[key];
      if (dateSet.has(key))       out[key] = d(v);
      else if (tsSet.has(key))    out[key] = ts(v);
      else if (arrSet.has(key))   out[key] = v || [];
      else if (objSet.has(key))   out[key] = v || {};
      else if (intSet.has(key))   out[key] = v != null ? parseInt(v, 10) : null;
      else if (floatSet.has(key)) out[key] = v != null ? parseFloat(v) : null;
      else                        out[key] = v;
    }
    if (aliases) {
      for (const [alias, src] of Object.entries(aliases)) {
        out[alias] = typeof src === 'function' ? src(row, out) : out[src];
      }
    }
    return out;
  };
}

// Allowed ORDER BY expressions — prevents SQL injection if a caller ever passes user input.
// Every paginate() call must use one of these exact strings.
const ALLOWED_ORDER_BY = new Set([
  'date_raised DESC', 'rtw_date DESC', 'referral_date DESC',
  'contract_start_date DESC', 'request_date DESC NULLS LAST',
  'request_date DESC', 'created_at DESC', 'transfer_date DESC',
]);

async function paginate(conn, sql, params, orderBy, shaper, pag = {}) {
  if (!ALLOWED_ORDER_BY.has(orderBy)) {
    throw new Error(`paginate: disallowed ORDER BY clause: ${orderBy}`);
  }
  const limit = Math.min(Math.max(parseInt(pag.limit) || 200, 1), 500);
  const offset = Math.max(parseInt(pag.offset) || 0, 0);
  const countSql = `SELECT COUNT(*) FROM (${sql}) _c`;
  const dataSql = `${sql} ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const [dataRes, countRes] = await Promise.all([
    conn.query(dataSql, [...params, limit, offset]),
    conn.query(countSql, params),
  ]);
  return { rows: dataRes.rows.map(shaper), total: parseInt(countRes.rows[0].count, 10) };
}

// ── Disciplinary Cases ──────────────────────────────────────────────────────

const shapeDisc = createShaper({
  fields: [
    'id', 'home_id', 'staff_id', 'date_raised', 'raised_by', 'source', 'source_ref', 'category',
    'allegation_summary', 'allegation_detail',
    'investigation_status', 'investigation_officer', 'investigation_start_date', 'investigation_notes',
    'witnesses', 'evidence_items', 'investigation_completed_date',
    'investigation_findings', 'investigation_recommendation',
    'suspended', 'suspension_date', 'suspension_reason', 'suspension_review_date',
    'suspension_end_date', 'suspension_on_full_pay',
    'hearing_status', 'hearing_date', 'hearing_time', 'hearing_location',
    'hearing_chair', 'hearing_letter_sent_date', 'hearing_companion_name', 'hearing_companion_role',
    'hearing_notes', 'hearing_employee_response',
    'outcome', 'outcome_date', 'outcome_reason', 'outcome_letter_sent_date', 'outcome_letter_method',
    'warning_expiry_date', 'notice_period_start', 'notice_period_end',
    'pay_in_lieu_of_notice', 'dismissal_effective_date',
    'appeal_status', 'appeal_received_date', 'appeal_deadline', 'appeal_grounds',
    'appeal_hearing_date', 'appeal_hearing_chair', 'appeal_hearing_companion_name',
    'appeal_outcome', 'appeal_outcome_date', 'appeal_outcome_reason', 'appeal_outcome_letter_sent_date',
    'linked_grievance_id', 'disciplinary_paused_for_grievance',
    'status', 'closed_date', 'closed_reason',
    'created_by', 'created_at', 'updated_at', 'version',
  ],
  dates: [
    'date_raised', 'investigation_start_date', 'investigation_completed_date',
    'suspension_date', 'suspension_review_date', 'suspension_end_date',
    'hearing_date', 'hearing_letter_sent_date', 'outcome_date', 'outcome_letter_sent_date',
    'warning_expiry_date', 'notice_period_start', 'notice_period_end', 'dismissal_effective_date',
    'appeal_received_date', 'appeal_deadline', 'appeal_hearing_date',
    'appeal_outcome_date', 'appeal_outcome_letter_sent_date', 'closed_date',
  ],
  jsonArrays: ['witnesses', 'evidence_items'],
  aliases: { outcome_notes: 'outcome_reason', appeal_date: 'appeal_received_date' },
});

export async function findDisciplinary(homeId, { staffId, status } = {}, client, pag) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_disciplinary_cases WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  return paginate(conn, sql, params, 'date_raised DESC', shapeDisc, pag);
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
     data.source ?? 'other', data.source_ref || null, data.category,
     data.allegation_summary, data.allegation_detail || null,
     data.status ?? 'open', data.created_by]
  );
  return shapeDisc(rows[0]);
}

export async function updateDisciplinary(id, homeId, data, client, version) {
  const conn = client || pool;
  // Build dynamic SET clause from provided fields
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'date_raised', 'raised_by', 'source', 'source_ref', 'category',
    'allegation_summary', 'allegation_detail',
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
  fields.push('version = version + 1');
  if (fields.length === 1) return findDisciplinaryById(id, homeId, client);
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_disciplinary_cases SET ${fields.join(', ')} ${where} RETURNING *`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeDisc(rows[0]);
}

// ── Grievance Cases ─────────────────────────────────────────────────────────

const shapeGrv = createShaper({
  fields: [
    'id', 'home_id', 'staff_id', 'date_raised', 'raised_by_method',
    'category', 'protected_characteristic', 'subject_summary', 'subject_detail', 'desired_outcome',
    'acknowledged_date', 'acknowledge_deadline', 'acknowledged_by',
    'investigation_status', 'investigation_officer', 'investigation_start_date', 'investigation_notes',
    'witnesses', 'evidence_items', 'investigation_completed_date', 'investigation_findings',
    'hearing_status', 'hearing_date', 'hearing_time', 'hearing_location',
    'hearing_chair', 'hearing_letter_sent_date', 'hearing_companion_name', 'hearing_companion_role',
    'hearing_notes', 'employee_statement_at_hearing',
    'outcome', 'outcome_date', 'outcome_reason', 'outcome_letter_sent_date',
    'mediation_offered', 'mediation_accepted', 'mediator_name',
    'appeal_status', 'appeal_received_date', 'appeal_deadline', 'appeal_grounds',
    'appeal_hearing_date', 'appeal_hearing_chair',
    'appeal_outcome', 'appeal_outcome_date', 'appeal_outcome_reason', 'appeal_outcome_letter_sent_date',
    'linked_disciplinary_id', 'triggers_disciplinary',
    'status', 'confidential', 'closed_date', 'closed_reason',
    'created_by', 'created_at', 'updated_at', 'version',
  ],
  dates: [
    'date_raised', 'acknowledged_date', 'acknowledge_deadline',
    'investigation_start_date', 'investigation_completed_date',
    'hearing_date', 'hearing_letter_sent_date', 'outcome_date', 'outcome_letter_sent_date',
    'appeal_received_date', 'appeal_deadline', 'appeal_hearing_date',
    'appeal_outcome_date', 'appeal_outcome_letter_sent_date', 'closed_date',
  ],
  jsonArrays: ['witnesses', 'evidence_items'],
  aliases: { description: 'subject_summary' },
});

export async function findGrievance(homeId, { staffId, status } = {}, client, pag) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_grievance_cases WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  return paginate(conn, sql, params, 'date_raised DESC', shapeGrv, pag);
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
    [homeId, data.staff_id, data.date_raised, data.raised_by_method ?? 'written', data.category,
     data.protected_characteristic || null, data.subject_summary || data.description,
     data.subject_detail || null, data.desired_outcome || null,
     data.status ?? 'open', data.confidential ?? false, data.created_by]
  );
  return shapeGrv(rows[0]);
}

export async function updateGrievance(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'date_raised', 'raised_by_method', 'category', 'protected_characteristic',
    'subject_summary', 'subject_detail', 'desired_outcome',
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
  fields.push('version = version + 1');
  if (fields.length === 1) return findGrievanceById(id, homeId, client);
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_grievance_cases SET ${fields.join(', ')} ${where} RETURNING *`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeGrv(rows[0]);
}

// ── Grievance Actions ───────────────────────────────────────────────────────

const shapeGrvAction = createShaper({
  fields: ['id', 'home_id', 'grievance_id', 'description', 'responsible', 'due_date', 'completed_date', 'status', 'created_at'],
  dates: ['due_date', 'completed_date'],
  timestamps: ['created_at'],
});

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
     data.due_date || null, data.status ?? 'pending']
  );
  return shapeGrvAction(rows[0]);
}

export async function updateGrievanceAction(id, homeId, data, client) {
  const conn = client || pool;
  const params = [id, homeId];
  const fields = [];
  const settable = ['status', 'completed_date', 'description', 'responsible', 'due_date'];
  for (const key of settable) {
    if (key in data) { params.push(data[key] ?? null); fields.push(`${key} = $${params.length}`); }
  }
  if (fields.length === 0) return shapeGrvAction((await conn.query('SELECT * FROM hr_grievance_actions WHERE id = $1 AND home_id = $2', [id, homeId])).rows[0]);
  const { rows } = await conn.query(
    `UPDATE hr_grievance_actions SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 RETURNING *`,
    params
  );
  return shapeGrvAction(rows[0]);
}

// ── Performance Cases ───────────────────────────────────────────────────────

const shapePerf = createShaper({
  fields: [
    'id', 'home_id', 'staff_id', 'type', 'date_raised', 'raised_by',
    'concern_summary', 'concern_detail', 'performance_area',
    'informal_discussion_date', 'informal_discussion_notes', 'informal_targets',
    'informal_review_date', 'informal_outcome',
    'pip_start_date', 'pip_end_date', 'pip_objectives', 'pip_overall_outcome', 'pip_extended_to',
    'hearing_status', 'hearing_date', 'hearing_time', 'hearing_location',
    'hearing_chair', 'hearing_letter_sent_date', 'hearing_companion_name', 'hearing_companion_role',
    'hearing_notes',
    'outcome', 'outcome_date', 'outcome_reason', 'outcome_letter_sent_date', 'warning_expiry_date',
    'redeployment_offered', 'redeployment_role', 'redeployment_accepted',
    'appeal_status', 'appeal_received_date', 'appeal_deadline', 'appeal_grounds',
    'appeal_hearing_date', 'appeal_outcome', 'appeal_outcome_date', 'appeal_outcome_reason',
    'status', 'closed_date',
    'created_by', 'created_at', 'updated_at', 'version',
  ],
  dates: [
    'date_raised', 'informal_discussion_date', 'informal_review_date',
    'pip_start_date', 'pip_end_date', 'pip_extended_to',
    'hearing_date', 'hearing_letter_sent_date', 'outcome_date', 'outcome_letter_sent_date',
    'warning_expiry_date', 'appeal_received_date', 'appeal_deadline',
    'appeal_hearing_date', 'appeal_outcome_date', 'closed_date',
  ],
  jsonArrays: ['informal_targets', 'pip_objectives'],
  aliases: { description: 'concern_summary', informal_notes: 'informal_discussion_notes', appeal_date: 'appeal_received_date' },
});

export async function findPerformance(homeId, { staffId, status, type } = {}, client, pag) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_performance_cases WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  if (type) { params.push(type); sql += ` AND type = $${params.length}`; }
  return paginate(conn, sql, params, 'date_raised DESC', shapePerf, pag);
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
     data.status ?? 'open', data.created_by]
  );
  return shapePerf(rows[0]);
}

export async function updatePerformance(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'concern_summary', 'concern_detail', 'performance_area', 'date_raised', 'raised_by', 'type',
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
  fields.push('version = version + 1');
  if (fields.length === 1) return findPerformanceById(id, homeId, client);
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_performance_cases SET ${fields.join(', ')} ${where} RETURNING *`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapePerf(rows[0]);
}

// ── RTW Interviews ──────────────────────────────────────────────────────────

const shapeRtw = createShaper({
  fields: [
    'id', 'home_id', 'staff_id',
    'absence_start_date', 'absence_end_date', 'absence_days', 'absence_reason',
    'rtw_date', 'rtw_conducted_by', 'fit_to_return', 'adjustments_needed',
    'adjustments_detail', 'underlying_condition', 'oh_referral_recommended', 'follow_up_date', 'notes',
    'fit_note_received', 'fit_note_date', 'fit_note_type', 'fit_note_adjustments', 'fit_note_review_date',
    'bradford_score_after', 'trigger_reached', 'action_taken', 'linked_case_id',
    'created_by', 'created_at', 'updated_at', 'version',
  ],
  dates: ['absence_start_date', 'absence_end_date', 'rtw_date', 'follow_up_date', 'fit_note_date', 'fit_note_review_date'],
  ints: ['absence_days'],
  floats: ['bradford_score_after'],
  aliases: {
    conducted_by: 'rtw_conducted_by', fit_for_work: 'fit_to_return',
    adjustments: 'adjustments_detail', referral_needed: 'oh_referral_recommended',
  },
});

export async function findRtwInterviewById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_rtw_interviews WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL', [id, homeId]);
  return shapeRtw(rows[0]);
}

export async function findRtwInterviews(homeId, { staffId } = {}, client, pag) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_rtw_interviews WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  return paginate(conn, sql, params, 'rtw_date DESC', shapeRtw, pag);
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
     data.absence_days ?? null, data.absence_reason || null,
     data.rtw_date, data.rtw_conducted_by, data.fit_to_return ?? true,
     data.adjustments_needed ?? false, data.adjustments_detail || null,
     data.underlying_condition ?? false, data.oh_referral_recommended ?? false,
     data.notes || null, data.fit_note_received ?? false, data.fit_note_date || null,
     data.fit_note_type || null, data.fit_note_adjustments || null,
     data.bradford_score_after ?? null, data.trigger_reached || null, data.action_taken || null,
     data.created_by || null]
  );
  return shapeRtw(rows[0]);
}

export async function updateRtwInterview(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'absence_start_date', 'rtw_date', 'rtw_conducted_by',
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
  fields.push('version = version + 1');
  if (fields.length === 1) return findRtwInterviewById(id, homeId, client);
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_rtw_interviews SET ${fields.join(', ')} ${where} RETURNING *`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeRtw(rows[0]);
}

// ── OH Referrals ────────────────────────────────────────────────────────────

const shapeOh = createShaper({
  fields: [
    'id', 'home_id', 'staff_id',
    'referral_date', 'referred_by', 'reason', 'questions_for_oh',
    'employee_consent_obtained', 'consent_date', 'oh_provider', 'appointment_date',
    'report_received_date', 'report_summary', 'fit_for_role', 'adjustments_recommended',
    'estimated_return_date', 'disability_likely', 'follow_up_date', 'adjustments_implemented',
    'status', 'created_by', 'created_at', 'updated_at', 'version',
  ],
  dates: ['referral_date', 'consent_date', 'appointment_date', 'report_received_date', 'estimated_return_date', 'follow_up_date'],
  jsonArrays: ['questions_for_oh', 'adjustments_implemented'],
  aliases: { provider: 'oh_provider', report_date: 'report_received_date', recommendations: 'adjustments_recommended' },
});

export async function findOhReferralById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_oh_referrals WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL', [id, homeId]);
  return shapeOh(rows[0]);
}

export async function findOhReferrals(homeId, { staffId, status } = {}, client, pag) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_oh_referrals WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  return paginate(conn, sql, params, 'referral_date DESC', shapeOh, pag);
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
     data.status ?? 'pending', data.created_by || null]
  );
  return shapeOh(rows[0]);
}

export async function updateOhReferral(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'referral_date', 'reason', 'referred_by',
    'employee_consent_obtained', 'consent_date', 'oh_provider', 'appointment_date', 'status',
    'report_received_date', 'report_summary', 'fit_for_role', 'adjustments_recommended',
    'estimated_return_date', 'disability_likely', 'follow_up_date', 'adjustments_implemented',
    'questions_for_oh', 'notes',
  ];
  const jsonFields = ['questions_for_oh', 'adjustments_implemented'];
  for (const key of settable) {
    if (key in data) {
      params.push(jsonFields.includes(key) ? JSON.stringify(data[key]) : data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  fields.push('version = version + 1');
  if (fields.length === 1) return findOhReferralById(id, homeId, client);
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_oh_referrals SET ${fields.join(', ')} ${where} RETURNING *`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeOh(rows[0]);
}

// ── Contracts ───────────────────────────────────────────────────────────────

const shapeContract = createShaper({
  fields: [
    'id', 'home_id', 'staff_id',
    'statement_issued', 'statement_issued_date', 'contract_type', 'contract_start_date', 'contract_end_date',
    'job_title', 'job_description_ref', 'reporting_to', 'place_of_work',
    'hours_per_week', 'working_pattern', 'hourly_rate', 'pay_frequency', 'annual_leave_days',
    'notice_period_employer', 'notice_period_employee',
    'probation_period_months', 'probation_start_date', 'probation_end_date',
    'probation_reviews', 'probation_outcome', 'probation_extension_date', 'probation_extension_reason',
    'probation_confirmed_date', 'probation_confirmation_letter_sent',
    'variations',
    'termination_type', 'termination_date', 'termination_reason', 'notice_given_date',
    'notice_given_by', 'last_working_day', 'garden_leave', 'pilon',
    'exit_interview_date', 'exit_interview_notes', 'references_agreed',
    'status', 'created_at', 'updated_at', 'version',
  ],
  dates: [
    'statement_issued_date', 'contract_start_date', 'contract_end_date',
    'probation_start_date', 'probation_end_date', 'probation_extension_date', 'probation_confirmed_date',
    'termination_date', 'notice_given_date', 'last_working_day', 'exit_interview_date',
  ],
  floats: ['hours_per_week', 'hourly_rate'],
  jsonArrays: ['probation_reviews', 'variations'],
  aliases: { start_date: 'contract_start_date', end_date: 'contract_end_date' },
});

export async function findContracts(homeId, { staffId, status } = {}, client, pag) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_contracts WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  return paginate(conn, sql, params, 'contract_start_date DESC', shapeContract, pag);
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
     data.hours_per_week ?? null, data.working_pattern || null,
     data.hourly_rate ?? null, data.pay_frequency || null, data.annual_leave_days ?? 28,
     data.notice_period_employer || null, data.notice_period_employee || null,
     data.probation_period_months || null, data.probation_start_date || null,
     data.probation_end_date || null, data.status ?? 'active']
  );
  return shapeContract(rows[0]);
}

export async function updateContract(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'contract_start_date', 'statement_issued', 'statement_issued_date', 'contract_type', 'contract_end_date',
    'job_title', 'job_description_ref', 'reporting_to', 'place_of_work',
    'hours_per_week', 'working_pattern', 'hourly_rate', 'pay_frequency', 'annual_leave_days',
    'notice_period_employer', 'notice_period_employee',
    'probation_period_months', 'probation_end_date', 'probation_reviews',
    'probation_outcome', 'probation_extension_date', 'probation_extension_reason',
    'probation_confirmed_date', 'probation_confirmation_letter_sent',
    'variations',
    'termination_type', 'termination_date', 'termination_reason', 'notice_given_date',
    'notice_given_by', 'last_working_day', 'garden_leave', 'pilon',
    'exit_interview_date', 'exit_interview_notes', 'references_agreed', 'status', 'notes',
  ];
  const jsonFields = ['probation_reviews', 'variations'];
  for (const key of settable) {
    if (key in data) {
      params.push(jsonFields.includes(key) ? JSON.stringify(data[key]) : data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  fields.push('version = version + 1');
  if (fields.length === 1) return findContractById(id, homeId, client);
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_contracts SET ${fields.join(', ')} ${where} RETURNING *`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeContract(rows[0]);
}

// ── Family Leave ────────────────────────────────────────────────────────────

const shapeFamilyLeave = createShaper({
  fields: [
    'id', 'home_id', 'staff_id', 'type',
    'request_date', 'expected_due_date', 'actual_birth_date',
    'mat_b1_received', 'mat_b1_date', 'paternity_week_choice', 'paternity_start_date',
    'spl_total_weeks', 'spl_notice_received_date', 'spl_partner_employer', 'spl_booking_notices',
    'matching_date', 'placement_date',
    'upl_child_name', 'upl_child_dob', 'upl_weeks_requested', 'upl_weeks_used_total',
    'bereavement_date', 'bereavement_relationship',
    'leave_start_date', 'leave_end_date', 'expected_return_date', 'actual_return_date',
    'statutory_pay_type', 'statutory_pay_start_date',
    'enhanced_pay', 'enhanced_pay_weeks', 'enhanced_pay_rate',
    'risk_assessment_date', 'risk_assessment_by', 'risks_identified', 'adjustments_made',
    'risk_assessment_review_date',
    'kit_days', 'split_days',
    'return_confirmed', 'return_pattern', 'flexible_working_request_linked',
    'protected_period_start', 'protected_period_end',
    'status', 'notes', 'created_by', 'created_at', 'updated_at', 'version',
  ],
  dates: [
    'request_date', 'expected_due_date', 'actual_birth_date', 'mat_b1_date',
    'paternity_start_date', 'spl_notice_received_date', 'matching_date', 'placement_date',
    'upl_child_dob', 'bereavement_date',
    'leave_start_date', 'leave_end_date', 'expected_return_date', 'actual_return_date',
    'statutory_pay_start_date', 'risk_assessment_date', 'risk_assessment_review_date',
    'protected_period_start', 'protected_period_end',
  ],
  floats: ['enhanced_pay_rate'],
  jsonArrays: ['spl_booking_notices', 'kit_days', 'split_days'],
  aliases: {
    leave_type: 'type',
    start_date: 'leave_start_date',
    end_date: 'leave_end_date',
    expected_return: 'expected_return_date',
    actual_return: 'actual_return_date',
    kit_days_used: (row) => row.kit_days != null ? (Array.isArray(row.kit_days) ? row.kit_days.length : row.kit_days) : 0,
    pay_type: 'statutory_pay_type',
  },
});

export async function findFamilyLeave(homeId, { staffId, type } = {}, client, pag) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_family_leave WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (type) { params.push(type); sql += ` AND type = $${params.length}`; }
  return paginate(conn, sql, params, 'request_date DESC NULLS LAST', shapeFamilyLeave, pag);
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
     data.expected_return_date || null, data.status ?? 'requested',
     data.notes || null, data.created_by || null]
  );
  return shapeFamilyLeave(rows[0]);
}

export async function updateFamilyLeave(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'type', 'request_date', 'expected_due_date', 'actual_birth_date', 'mat_b1_received', 'mat_b1_date',
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
  fields.push('version = version + 1');
  if (fields.length === 1) return findFamilyLeaveById(id, homeId, client);
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_family_leave SET ${fields.join(', ')} ${where} RETURNING *`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeFamilyLeave(rows[0]);
}

// ── Flexible Working ────────────────────────────────────────────────────────

const shapeFlex = createShaper({
  fields: [
    'id', 'home_id', 'staff_id',
    'request_date', 'effective_date_requested', 'current_pattern', 'requested_change',
    'reason', 'employee_assessment_of_impact', 'decision_deadline', 'meeting_date', 'meeting_notes',
    'decision', 'decision_date', 'decision_by', 'refusal_reason', 'refusal_explanation',
    'approved_pattern', 'approved_effective_date', 'trial_period', 'trial_period_end',
    'contract_variation_id',
    'appeal_date', 'appeal_grounds', 'appeal_outcome', 'appeal_outcome_date',
    'status', 'notes', 'created_by', 'created_at', 'updated_at', 'version',
  ],
  dates: [
    'request_date', 'effective_date_requested', 'decision_deadline', 'meeting_date',
    'decision_date', 'approved_effective_date', 'trial_period_end',
    'appeal_date', 'appeal_outcome_date',
  ],
  aliases: { decision_reason: 'refusal_reason' },
});

export async function findFlexWorking(homeId, { staffId, status } = {}, client, pag) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_flexible_working WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  return paginate(conn, sql, params, 'request_date DESC', shapeFlex, pag);
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
     data.status ?? 'pending', data.created_by || null]
  );
  return shapeFlex(rows[0]);
}

export async function updateFlexWorking(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'request_date', 'requested_change', 'decision_deadline', 'reason', 'current_pattern',
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
  fields.push('version = version + 1');
  if (fields.length === 1) return findFlexWorkingById(id, homeId, client);
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_flexible_working SET ${fields.join(', ')} ${where} RETURNING *`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeFlex(rows[0]);
}

// ── EDI Records ─────────────────────────────────────────────────────────────

const shapeEdi = createShaper({
  fields: [
    'id', 'home_id', 'record_type', 'staff_id',
    'complaint_date', 'harassment_category', 'third_party', 'third_party_type',
    'respondent_type', 'respondent_staff_id', 'respondent_name',
    'handling_route', 'linked_case_id', 'reasonable_steps_evidence',
    'condition_description', 'adjustments', 'oh_referral_id',
    'access_to_work_applied', 'access_to_work_reference', 'access_to_work_amount',
    'description', 'status', 'outcome', 'notes',
    'created_at', 'updated_at', 'version',
  ],
  dates: ['complaint_date'],
  floats: ['access_to_work_amount'],
  jsonArrays: ['reasonable_steps_evidence', 'adjustments'],
  aliases: { date_recorded: 'complaint_date', category: 'harassment_category', respondent_role: 'respondent_type' },
});

export async function findEdi(homeId, { recordType, staffId } = {}, client, pag) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_edi_records WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (recordType) { params.push(recordType); sql += ` AND record_type = $${params.length}`; }
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  return paginate(conn, sql, params, 'created_at DESC', shapeEdi, pag);
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
     data.status ?? 'open']
  );
  return shapeEdi(rows[0]);
}

export async function updateEdi(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'record_type', 'complaint_date', 'harassment_category', 'third_party', 'third_party_type',
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
  fields.push('version = version + 1');
  if (fields.length === 1) return findEdiById(id, homeId, client);
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_edi_records SET ${fields.join(', ')} ${where} RETURNING *`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeEdi(rows[0]);
}

// ── TUPE Transfers ──────────────────────────────────────────────────────────

const shapeTupe = createShaper({
  fields: [
    'id', 'home_id', 'transfer_type', 'transfer_date',
    'transferor_name', 'transferee_name', 'employees',
    'consultation_start_date', 'consultation_end_date',
    'measures_letter_date', 'measures_description',
    'employee_reps_consulted', 'rep_names',
    'eli_received_date', 'eli_complete', 'eli_items',
    'dd_notes', 'outstanding_claims', 'outstanding_tribunal_claims',
    'status', 'notes', 'created_by', 'created_at', 'updated_at', 'version',
  ],
  dates: ['transfer_date', 'consultation_start_date', 'consultation_end_date', 'measures_letter_date', 'eli_received_date'],
  jsonArrays: ['employees'],
  jsonObjects: ['eli_items'],
  aliases: {
    staff_affected: (row) => Array.isArray(row.employees) ? row.employees.length : (row.employees?.count ?? null),
    consultation_start: 'consultation_start_date',
    consultation_end: 'consultation_end_date',
    eli_sent_date: 'eli_received_date',
    measures_proposed: 'measures_description',
  },
});

export async function findTupe(homeId, client, pag) {
  const conn = client || pool;
  const sql = 'SELECT * FROM hr_tupe_transfers WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  return paginate(conn, sql, params, 'transfer_date DESC', shapeTupe, pag);
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
     JSON.stringify(data.employees || []), data.status ?? 'planned',
     data.notes || null, data.created_by || null]
  );
  return shapeTupe(rows[0]);
}

export async function updateTupe(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'transfer_type', 'transfer_date', 'transferor_name', 'transferee_name', 'employees',
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
  fields.push('version = version + 1');
  if (fields.length === 1) return findTupeById(id, homeId, client);
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_tupe_transfers SET ${fields.join(', ')} ${where} RETURNING *`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeTupe(rows[0]);
}

// ── RTW & DBS Renewals ──────────────────────────────────────────────────────

const shapeRenewal = createShaper({
  fields: [
    'id', 'home_id', 'staff_id', 'check_type',
    'dbs_certificate_number', 'dbs_disclosure_level', 'dbs_check_date', 'dbs_next_renewal_due',
    'dbs_update_service_registered', 'dbs_update_service_last_checked', 'dbs_barred_list_check',
    'rtw_document_type', 'rtw_check_date', 'rtw_document_expiry', 'rtw_next_check_due',
    'status', 'checked_by', 'notes', 'created_at', 'updated_at', 'version',
  ],
  dates: ['dbs_check_date', 'dbs_next_renewal_due', 'dbs_update_service_last_checked', 'rtw_check_date', 'rtw_document_expiry', 'rtw_next_check_due'],
  aliases: {
    last_checked: (row, out) => out.check_type === 'dbs' ? out.dbs_check_date : out.rtw_check_date,
    expiry_date: (row, out) => out.check_type === 'dbs' ? out.dbs_next_renewal_due : out.rtw_document_expiry,
    reference: (row) => row.check_type === 'dbs' ? row.dbs_certificate_number : null,
    certificate_number: 'dbs_certificate_number',
    document_type: 'rtw_document_type',
  },
});

export async function findRenewals(homeId, { staffId, checkType, status } = {}, client, pag) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_rtw_dbs_renewals WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (checkType) { params.push(checkType); sql += ` AND check_type = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  return paginate(conn, sql, params, 'created_at DESC', shapeRenewal, pag);
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
     data.status ?? 'current', data.checked_by || null, data.notes || null]
  );
  return shapeRenewal(rows[0]);
}

export async function updateRenewal(id, homeId, data, client, version) {
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
  fields.push('version = version + 1');
  if (fields.length === 1) return findRenewalById(id, homeId, client);
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_rtw_dbs_renewals SET ${fields.join(', ')} ${where} RETURNING *`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeRenewal(rows[0]);
}

// ── Case Notes (shared across all HR case types) ────────────────────────────

const shapeNote = createShaper({
  fields: ['id', 'home_id', 'case_type', 'case_id', 'note_type', 'content', 'author', 'created_at'],
  timestamps: ['created_at'],
});

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
    [homeId, caseType, caseId, data.note_type ?? 'note', data.content, data.author]
  );
  return shapeNote(rows[0]);
}

// ── Absence / Bradford Factor queries ────────────────────────────────────────

/**
 * All SICK shift_overrides for a home since cutoff, ordered for Bradford Factor grouping.
 */
export async function findSickOverrides(homeId, cutoff, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT date, staff_id FROM shift_overrides
     WHERE home_id = $1 AND shift = 'SICK' AND date >= $2
     ORDER BY staff_id, date`,
    [homeId, cutoff]
  );
  return rows;
}

/**
 * SICK shift_overrides for a single staff member since cutoff.
 */
export async function findStaffSickOverrides(homeId, staffId, cutoff, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT date FROM shift_overrides
     WHERE home_id = $1 AND staff_id = $2 AND shift = 'SICK' AND date >= $3
     ORDER BY date`,
    [homeId, staffId, cutoff]
  );
  return rows;
}

/**
 * Home config (for absence_triggers lookup).
 */
export async function findHomeConfig(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT config FROM homes WHERE id = $1', [homeId]
  );
  return rows[0]?.config || {};
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

const shapeAttachment = createShaper({
  fields: [
    'id', 'home_id', 'case_type', 'case_id', 'original_name', 'stored_name',
    'mime_type', 'size_bytes', 'description', 'uploaded_by', 'created_at',
  ],
  timestamps: ['created_at'],
});

export async function findAttachments(caseType, caseId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_file_attachments WHERE case_type = $1 AND case_id = $2 AND home_id = $3 AND deleted_at IS NULL ORDER BY created_at DESC',
    [caseType, caseId, homeId]
  );
  return rows.map(shapeAttachment);
}

export async function findAttachmentById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_file_attachments WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
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
    'UPDATE hr_file_attachments SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING *',
    [id, homeId]
  );
  return shapeAttachment(rows[0]);
}

// ── Investigation Meetings ──────────────────────────────────────────────────

const shapeMeeting = createShaper({
  fields: [
    'id', 'home_id', 'case_type', 'case_id',
    'meeting_date', 'meeting_time', 'meeting_type', 'location', 'attendees',
    'summary', 'key_points', 'outcome', 'recorded_by',
    'created_at', 'updated_at', 'version',
  ],
  dates: ['meeting_date'],
  jsonArrays: ['attendees'],
});

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
    [homeId, caseType, caseId, data.meeting_date, data.meeting_time || null, data.meeting_type ?? 'interview', data.location || null,
     JSON.stringify(data.attendees || []), data.summary || null, data.key_points || null, data.outcome || null, data.recorded_by]
  );
  return shapeMeeting(rows[0]);
}

export async function updateMeeting(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const vals = [];
  let n = 1;
  for (const key of ['meeting_date','meeting_time','meeting_type','location','summary','key_points','outcome']) {
    if (data[key] !== undefined) { fields.push(`${key} = $${n}`); vals.push(data[key]); n++; }
  }
  if (data.attendees !== undefined) { fields.push(`attendees = $${n}`); vals.push(JSON.stringify(data.attendees)); n++; }
  fields.push('version = version + 1');
  if (fields.length === 1) {
    const { rows } = await conn.query('SELECT * FROM hr_investigation_meetings WHERE id = $1 AND home_id = $2', [id, homeId]);
    return shapeMeeting(rows[0]);
  }
  vals.push(id, homeId);
  let where = `WHERE id = $${n} AND home_id = $${n + 1}`;
  n += 2;
  if (version != null) { vals.push(version); where += ` AND version = $${n}`; n++; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_investigation_meetings SET ${fields.join(', ')} ${where} RETURNING *`,
    vals
  );
  if (rowCount === 0 && version != null) return null;
  return shapeMeeting(rows[0]);
}

// ── Generic Soft Delete ──────────────────────────────────────────────────────

const SOFT_DELETE_TABLES = new Set([
  'hr_disciplinary_cases', 'hr_grievance_cases', 'hr_performance_cases',
  'hr_rtw_interviews', 'hr_oh_referrals', 'hr_contracts',
  'hr_family_leave', 'hr_flexible_working', 'hr_edi_records',
  'hr_tupe_transfers', 'hr_rtw_dbs_renewals',
]);

export async function softDeleteCase(table, id, homeId, client) {
  if (!SOFT_DELETE_TABLES.has(table)) throw new Error(`softDeleteCase: disallowed table: ${table}`);
  const conn = client || pool;
  const { rowCount } = await conn.query(
    `UPDATE ${table} SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rowCount > 0;
}

// ── GDPR Purge ──────────────────────────────────────────────────────────────

export async function purgeExpiredRecords(homeId, retentionYears = 6, dryRun = true) {
  const caseTables = [
    'hr_disciplinary_cases', 'hr_grievance_cases', 'hr_performance_cases',
    'hr_rtw_interviews', 'hr_oh_referrals', 'hr_contracts',
    'hr_family_leave', 'hr_flexible_working', 'hr_edi_records',
    'hr_tupe_transfers', 'hr_rtw_dbs_renewals',
  ];
  // Map case_type values to their parent tables for child record purging
  const caseTypeMap = {
    disciplinary: 'hr_disciplinary_cases', grievance: 'hr_grievance_cases',
    performance: 'hr_performance_cases', rtw_interview: 'hr_rtw_interviews',
    oh_referral: 'hr_oh_referrals', contract: 'hr_contracts',
    family_leave: 'hr_family_leave', flexible_working: 'hr_flexible_working',
    edi: 'hr_edi_records', tupe: 'hr_tupe_transfers', renewal: 'hr_rtw_dbs_renewals',
  };
  const cutoffExpr = `NOW() - make_interval(years => $2)`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counts = {};
    const years = parseInt(retentionYears, 10);

    // 1. Purge child records whose parent cases are expired (no deleted_at on child tables)
    const childTables = ['hr_case_notes', 'hr_file_attachments', 'hr_investigation_meetings'];
    for (const child of childTables) {
      let total = 0;
      for (const [caseType, parentTable] of Object.entries(caseTypeMap)) {
        const subquery = `SELECT id FROM ${parentTable} WHERE home_id = $1 AND deleted_at IS NOT NULL AND deleted_at < ${cutoffExpr}`;
        const sql = dryRun
          ? `SELECT COUNT(*) FROM ${child} WHERE home_id = $1 AND case_type = '${caseType}' AND case_id IN (${subquery})`
          : `DELETE FROM ${child} WHERE home_id = $1 AND case_type = '${caseType}' AND case_id IN (${subquery})`;
        const result = await client.query(sql, [homeId, years]);
        total += dryRun ? parseInt(result.rows[0].count, 10) : result.rowCount;
      }
      counts[child] = total;
    }

    // 2. Purge grievance actions (FK to hr_grievance_cases, not case_type pattern)
    const grvSub = `SELECT id FROM hr_grievance_cases WHERE home_id = $1 AND deleted_at IS NOT NULL AND deleted_at < ${cutoffExpr}`;
    if (dryRun) {
      const { rows } = await client.query(
        `SELECT COUNT(*) FROM hr_grievance_actions WHERE grievance_id IN (${grvSub})`, [homeId, years]);
      counts.hr_grievance_actions = parseInt(rows[0].count, 10);
    } else {
      const { rowCount } = await client.query(
        `DELETE FROM hr_grievance_actions WHERE grievance_id IN (${grvSub})`, [homeId, years]);
      counts.hr_grievance_actions = rowCount;
    }

    // 3. Purge main case tables (have deleted_at column)
    for (const table of caseTables) {
      if (dryRun) {
        const { rows } = await client.query(
          `SELECT COUNT(*) FROM ${table} WHERE home_id = $1 AND deleted_at IS NOT NULL AND deleted_at < ${cutoffExpr}`,
          [homeId, years]
        );
        counts[table] = parseInt(rows[0].count, 10);
      } else {
        const { rowCount } = await client.query(
          `DELETE FROM ${table} WHERE home_id = $1 AND deleted_at IS NOT NULL AND deleted_at < ${cutoffExpr}`,
          [homeId, years]
        );
        counts[table] = rowCount;
      }
    }

    await client.query('COMMIT');
    return counts;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
