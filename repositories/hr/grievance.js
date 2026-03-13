import { pool, createShaper, paginate } from './shared.js';

const COLS = `id, home_id, staff_id, date_raised, raised_by_method,
  category, protected_characteristic, subject_summary, subject_detail, desired_outcome,
  acknowledged_date, acknowledge_deadline, acknowledged_by,
  investigation_status, investigation_officer, investigation_start_date, investigation_notes,
  witnesses, evidence_items, investigation_completed_date, investigation_findings,
  hearing_status, hearing_date, hearing_time, hearing_location,
  hearing_chair, hearing_letter_sent_date, hearing_companion_name, hearing_companion_role,
  hearing_notes, employee_statement_at_hearing,
  outcome, outcome_date, outcome_reason, outcome_letter_sent_date,
  mediation_offered, mediation_accepted, mediator_name,
  appeal_status, appeal_received_date, appeal_deadline, appeal_grounds,
  appeal_hearing_date, appeal_hearing_chair,
  appeal_outcome, appeal_outcome_date, appeal_outcome_reason, appeal_outcome_letter_sent_date,
  linked_disciplinary_id, triggers_disciplinary,
  status, confidential, closed_date, closed_reason,
  created_by, created_at, updated_at, deleted_at, version`;

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
  let sql = `SELECT ${COLS} FROM hr_grievance_cases WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  return paginate(conn, sql, params, 'date_raised DESC', shapeGrv, pag);
}

export async function findGrievanceById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_grievance_cases WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`, [id, homeId]);
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

const ACTION_COLS = 'id, home_id, grievance_id, description, responsible, due_date, completed_date, status, created_at';

const shapeGrvAction = createShaper({
  fields: ['id', 'home_id', 'grievance_id', 'description', 'responsible', 'due_date', 'completed_date', 'status', 'created_at'],
  dates: ['due_date', 'completed_date'],
  timestamps: ['created_at'],
});

export async function findGrievanceActions(grievanceId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${ACTION_COLS} FROM hr_grievance_actions WHERE grievance_id = $1 AND home_id = $2 ORDER BY created_at`,
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
  if (fields.length === 0) return shapeGrvAction((await conn.query(`SELECT ${ACTION_COLS} FROM hr_grievance_actions WHERE id = $1 AND home_id = $2`, [id, homeId])).rows[0]);
  const { rows } = await conn.query(
    `UPDATE hr_grievance_actions SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 RETURNING *`,
    params
  );
  return shapeGrvAction(rows[0]);
}
