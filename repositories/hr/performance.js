import { pool, createShaper, paginate } from './shared.js';

const COLS = `id, home_id, staff_id, type, date_raised, raised_by,
  concern_summary, concern_detail, performance_area,
  informal_discussion_date, informal_discussion_notes, informal_targets,
  informal_review_date, informal_outcome,
  pip_start_date, pip_end_date, pip_objectives, pip_overall_outcome, pip_extended_to,
  hearing_status, hearing_date, hearing_time, hearing_location,
  hearing_chair, hearing_letter_sent_date, hearing_companion_name, hearing_companion_role,
  hearing_notes,
  outcome, outcome_date, outcome_reason, outcome_letter_sent_date, warning_expiry_date,
  redeployment_offered, redeployment_role, redeployment_accepted,
  appeal_status, appeal_received_date, appeal_deadline, appeal_grounds,
  appeal_hearing_date, appeal_outcome, appeal_outcome_date, appeal_outcome_reason,
  status, closed_date,
  created_by, created_at, updated_at, deleted_at, version`;

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
  let sql = `SELECT ${COLS} FROM hr_performance_cases WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  if (type) { params.push(type); sql += ` AND type = $${params.length}`; }
  return paginate(conn, sql, params, 'date_raised DESC', shapePerf, pag);
}

export async function findPerformanceById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_performance_cases WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`, [id, homeId]);
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
