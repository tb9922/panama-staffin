import { pool, createShaper, paginate } from './shared.js';

const COLS = `id, home_id, staff_id,
  referral_date, referred_by, reason, questions_for_oh,
  employee_consent_obtained, consent_date, oh_provider, appointment_date,
  report_received_date, report_summary, fit_for_role, adjustments_recommended,
  estimated_return_date, disability_likely, follow_up_date, adjustments_implemented,
  notes, status, created_by, created_at, updated_at, deleted_at, version`;

const shapeOh = createShaper({
  fields: [
    'id', 'home_id', 'staff_id',
    'referral_date', 'referred_by', 'reason', 'questions_for_oh',
    'employee_consent_obtained', 'consent_date', 'oh_provider', 'appointment_date',
    'report_received_date', 'report_summary', 'fit_for_role', 'adjustments_recommended',
    'estimated_return_date', 'disability_likely', 'follow_up_date', 'adjustments_implemented',
    'notes', 'status', 'created_by', 'created_at', 'updated_at', 'version',
  ],
  dates: ['referral_date', 'consent_date', 'appointment_date', 'report_received_date', 'estimated_return_date', 'follow_up_date'],
  jsonArrays: ['questions_for_oh', 'adjustments_implemented'],
  aliases: { provider: 'oh_provider', report_date: 'report_received_date', recommendations: 'adjustments_recommended' },
});

export async function findOhReferralById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_oh_referrals WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`, [id, homeId]);
  return shapeOh(rows[0]);
}

export async function findOhReferrals(homeId, { staffId, status } = {}, client, pag) {
  const conn = client || pool;
  let sql = `SELECT ${COLS} FROM hr_oh_referrals WHERE home_id = $1 AND deleted_at IS NULL`;
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
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${COLS}`,
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
    `UPDATE hr_oh_referrals SET ${fields.join(', ')} ${where} RETURNING ${COLS}`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeOh(rows[0]);
}
