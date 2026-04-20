import { ValidationError } from '../../errors.js';
import { pool, createShaper, paginate } from './shared.js';

function parseDateOnly(value) {
  if (!value) return null;
  return new Date(`${value}T00:00:00Z`);
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addMonthsClamped(value, months) {
  const parsed = parseDateOnly(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth();
  const day = parsed.getUTCDate();
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();
  return formatDateOnly(new Date(Date.UTC(year, month + months, Math.min(day, lastDayOfTargetMonth))));
}

function resolveDecisionDeadline(requestDate) {
  const deadline = addMonthsClamped(requestDate, 2);
  if (!deadline) throw new ValidationError('Request date is required to calculate the decision deadline');
  return deadline;
}

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
  aliases: {
    decision_reason: (row, out) => out.refusal_reason || out.refusal_explanation || null,
  },
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
  const decisionDeadline = resolveDecisionDeadline(data.request_date);
  const { rows } = await conn.query(
    `INSERT INTO hr_flexible_working
       (home_id, staff_id, request_date, effective_date_requested, current_pattern,
        requested_change, reason, employee_assessment_of_impact, decision_deadline,
        meeting_date, meeting_notes, decision, decision_date, decision_by,
        refusal_reason, refusal_explanation, approved_pattern, approved_effective_date,
        trial_period, trial_period_end, contract_variation_id, appeal_date, appeal_grounds,
        appeal_outcome, appeal_outcome_date, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28) RETURNING ${COLS}`,
    [homeId, data.staff_id, data.request_date, data.effective_date_requested || null,
     data.current_pattern || null, data.requested_change, data.reason || null,
     data.employee_assessment_of_impact || null, decisionDeadline,
     data.meeting_date || null, data.meeting_notes || null, data.decision || null,
     data.decision_date || null, data.decision_by || null, data.refusal_reason || null,
     data.refusal_explanation || null, data.approved_pattern || null, data.approved_effective_date || null,
     data.trial_period ?? false, data.trial_period_end || null, data.contract_variation_id || null,
     data.appeal_date || null, data.appeal_grounds || null, data.appeal_outcome || null,
     data.appeal_outcome_date || null, data.status ?? 'pending', data.notes || null, data.created_by || null]
  );
  return shapeFlex(rows[0]);
}

export async function updateFlexWorking(id, homeId, data, client, version) {
  const conn = client || pool;
  const normalized = { ...data };
  if ('request_date' in normalized && !('decision_deadline' in normalized)) {
    normalized.decision_deadline = normalized.request_date ? resolveDecisionDeadline(normalized.request_date) : null;
  }
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'request_date', 'effective_date_requested', 'requested_change', 'decision_deadline', 'reason', 'current_pattern',
    'employee_assessment_of_impact',
    'meeting_date', 'meeting_notes', 'decision', 'decision_date', 'decision_by',
    'refusal_reason', 'refusal_explanation',
    'approved_pattern', 'approved_effective_date', 'trial_period', 'trial_period_end',
    'contract_variation_id',
    'appeal_date', 'appeal_grounds', 'appeal_outcome', 'appeal_outcome_date',
    'status', 'notes',
  ];
  for (const key of settable) {
    if (key in normalized) { params.push(normalized[key] ?? null); fields.push(`${key} = $${params.length}`); }
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
