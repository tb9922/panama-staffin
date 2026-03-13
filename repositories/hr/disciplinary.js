import { pool, createShaper, paginate } from './shared.js';

const COLS = `id, home_id, staff_id, date_raised, raised_by, source, source_ref, category,
  allegation_summary, allegation_detail,
  investigation_status, investigation_officer, investigation_start_date, investigation_notes,
  witnesses, evidence_items, investigation_completed_date,
  investigation_findings, investigation_recommendation,
  suspended, suspension_date, suspension_reason, suspension_review_date,
  suspension_end_date, suspension_on_full_pay,
  hearing_status, hearing_date, hearing_time, hearing_location,
  hearing_chair, hearing_letter_sent_date, hearing_companion_name, hearing_companion_role,
  hearing_notes, hearing_employee_response,
  outcome, outcome_date, outcome_reason, outcome_letter_sent_date, outcome_letter_method,
  warning_expiry_date, notice_period_start, notice_period_end,
  pay_in_lieu_of_notice, dismissal_effective_date,
  appeal_status, appeal_received_date, appeal_deadline, appeal_grounds,
  appeal_hearing_date, appeal_hearing_chair, appeal_hearing_companion_name,
  appeal_outcome, appeal_outcome_date, appeal_outcome_reason, appeal_outcome_letter_sent_date,
  linked_grievance_id, disciplinary_paused_for_grievance,
  status, closed_date, closed_reason,
  created_by, created_at, updated_at, deleted_at, version`;

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
  let sql = `SELECT ${COLS} FROM hr_disciplinary_cases WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  return paginate(conn, sql, params, 'date_raised DESC', shapeDisc, pag);
}

export async function findDisciplinaryById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_disciplinary_cases WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`, [id, homeId]);
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
