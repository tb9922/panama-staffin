import { pool, createShaper, paginate } from './shared.js';

const COLS = `id, home_id, staff_id,
  absence_start_date, absence_end_date, absence_days, absence_reason,
  rtw_date, rtw_conducted_by, fit_to_return, adjustments_needed,
  adjustments_detail, underlying_condition, oh_referral_recommended, follow_up_date, notes,
  fit_note_received, fit_note_date, fit_note_type, fit_note_adjustments, fit_note_review_date,
  bradford_score_after, trigger_reached, action_taken, linked_case_id,
  created_by, created_at, updated_at, deleted_at, version`;

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
    `SELECT ${COLS} FROM hr_rtw_interviews WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`, [id, homeId]);
  return shapeRtw(rows[0]);
}

export async function findRtwInterviews(homeId, { staffId } = {}, client, pag) {
  const conn = client || pool;
  let sql = `SELECT ${COLS} FROM hr_rtw_interviews WHERE home_id = $1 AND deleted_at IS NULL`;
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
         underlying_condition, oh_referral_recommended, follow_up_date, notes,
         fit_note_received, fit_note_date, fit_note_type, fit_note_adjustments, fit_note_review_date,
         bradford_score_after, trigger_reached, action_taken, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING ${COLS}`,
    [homeId, data.staff_id, data.absence_start_date, data.absence_end_date || null,
      data.absence_days ?? null, data.absence_reason || null,
      data.rtw_date, data.rtw_conducted_by, data.fit_to_return ?? true,
      data.adjustments_needed ?? false, data.adjustments_detail || null,
      data.underlying_condition ?? false, data.oh_referral_recommended ?? false,
      data.follow_up_date || null, data.notes || null, data.fit_note_received ?? false, data.fit_note_date || null,
      data.fit_note_type || null, data.fit_note_adjustments || null, data.fit_note_review_date || null,
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
    `UPDATE hr_rtw_interviews SET ${fields.join(', ')} ${where} RETURNING ${COLS}`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeRtw(rows[0]);
}
