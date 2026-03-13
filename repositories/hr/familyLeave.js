import { pool, createShaper, paginate } from './shared.js';

const COLS = `id, home_id, staff_id, type,
  request_date, expected_due_date, actual_birth_date,
  mat_b1_received, mat_b1_date, paternity_week_choice, paternity_start_date,
  spl_total_weeks, spl_notice_received_date, spl_partner_employer, spl_booking_notices,
  matching_date, placement_date,
  upl_child_name, upl_child_dob, upl_weeks_requested, upl_weeks_used_total,
  bereavement_date, bereavement_relationship,
  leave_start_date, leave_end_date, expected_return_date, actual_return_date,
  statutory_pay_type, statutory_pay_start_date,
  enhanced_pay, enhanced_pay_weeks, enhanced_pay_rate,
  risk_assessment_date, risk_assessment_by, risks_identified, adjustments_made,
  risk_assessment_review_date,
  kit_days, split_days,
  return_confirmed, return_pattern, flexible_working_request_linked,
  protected_period_start, protected_period_end,
  status, notes, created_by, created_at, updated_at, deleted_at, version`;

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
  let sql = `SELECT ${COLS} FROM hr_family_leave WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (type) { params.push(type); sql += ` AND type = $${params.length}`; }
  return paginate(conn, sql, params, 'request_date DESC NULLS LAST', shapeFamilyLeave, pag);
}

export async function findFamilyLeaveById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_family_leave WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`, [id, homeId]);
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
