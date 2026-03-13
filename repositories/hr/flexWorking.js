import { pool, createShaper, paginate } from './shared.js';

const COLS = `id, home_id, staff_id,
  request_date, effective_date_requested, current_pattern, requested_change,
  reason, employee_assessment_of_impact, decision_deadline, meeting_date, meeting_notes,
  decision, decision_date, decision_by, refusal_reason, refusal_explanation,
  approved_pattern, approved_effective_date, trial_period, trial_period_end,
  contract_variation_id,
  appeal_date, appeal_grounds, appeal_outcome, appeal_outcome_date,
  status, notes, created_by, created_at, updated_at, deleted_at, version`;

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
  let sql = `SELECT ${COLS} FROM hr_flexible_working WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  return paginate(conn, sql, params, 'request_date DESC', shapeFlex, pag);
}

export async function findFlexWorkingById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_flexible_working WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`, [id, homeId]);
  return shapeFlex(rows[0]);
}

export async function createFlexWorking(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_flexible_working
       (home_id, staff_id, request_date, effective_date_requested, current_pattern,
        requested_change, reason, employee_assessment_of_impact, decision_deadline, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${COLS}`,
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
    `UPDATE hr_flexible_working SET ${fields.join(', ')} ${where} RETURNING ${COLS}`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeFlex(rows[0]);
}
