import { pool, createShaper, paginate } from './shared.js';

const COLS = `id, home_id, staff_id, check_type,
  dbs_certificate_number, dbs_disclosure_level, dbs_check_date, dbs_next_renewal_due,
  dbs_update_service_registered, dbs_update_service_last_checked, dbs_barred_list_check,
  rtw_document_type, rtw_check_date, rtw_document_expiry, rtw_next_check_due,
  status, checked_by, notes, created_by, created_at, updated_at, deleted_at, version`;

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
  let sql = `SELECT ${COLS} FROM hr_rtw_dbs_renewals WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (checkType) { params.push(checkType); sql += ` AND check_type = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  return paginate(conn, sql, params, 'created_at DESC', shapeRenewal, pag);
}

export async function findRenewalById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_rtw_dbs_renewals WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`, [id, homeId]);
  return shapeRenewal(rows[0]);
}

export async function createRenewal(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_rtw_dbs_renewals
       (home_id, staff_id, check_type,
        dbs_certificate_number, dbs_disclosure_level, dbs_check_date, dbs_next_renewal_due,
        dbs_update_service_registered, dbs_update_service_last_checked, dbs_barred_list_check,
        rtw_document_type, rtw_check_date, rtw_document_expiry, rtw_next_check_due,
        status, checked_by, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING ${COLS}`,
    [homeId, data.staff_id, data.check_type,
     data.dbs_certificate_number || null, data.dbs_disclosure_level || null,
     data.dbs_check_date || null, data.dbs_next_renewal_due || null,
     data.dbs_update_service_registered ?? false, data.dbs_update_service_last_checked || null,
     data.dbs_barred_list_check ?? true,
     data.rtw_document_type || null, data.rtw_check_date || null,
     data.rtw_document_expiry || null, data.rtw_next_check_due || null,
     data.status ?? 'current', data.checked_by || null, data.notes || null,
     data.created_by || null]
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
    `UPDATE hr_rtw_dbs_renewals SET ${fields.join(', ')} ${where} RETURNING ${COLS}`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeRenewal(rows[0]);
}
