import { pool, createShaper, paginate } from './shared.js';

const COLS = `id, home_id, transfer_type, transfer_date, signed_date,
  transferor_name, transferee_name, employees,
  consultation_start_date, consultation_end_date,
  measures_letter_date, measures_description,
  employee_reps_consulted, rep_names,
  eli_received_date, eli_complete, eli_items,
  dd_notes, outstanding_claims, outstanding_tribunal_claims,
  status, notes, created_by, created_at, updated_at, deleted_at, version`;

const shapeTupe = createShaper({
  fields: [
    'id', 'home_id', 'transfer_type', 'transfer_date', 'signed_date',
    'transferor_name', 'transferee_name', 'employees',
    'consultation_start_date', 'consultation_end_date',
    'measures_letter_date', 'measures_description',
    'employee_reps_consulted', 'rep_names',
    'eli_received_date', 'eli_complete', 'eli_items',
    'dd_notes', 'outstanding_claims', 'outstanding_tribunal_claims',
    'status', 'notes', 'created_by', 'created_at', 'updated_at', 'version',
  ],
  dates: ['transfer_date', 'signed_date', 'consultation_start_date', 'consultation_end_date', 'measures_letter_date', 'eli_received_date'],
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
  const sql = `SELECT ${COLS} FROM hr_tupe_transfers WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  return paginate(conn, sql, params, 'transfer_date DESC', shapeTupe, pag);
}

export async function findTupeById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_tupe_transfers WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`, [id, homeId]);
  return shapeTupe(rows[0]);
}

export async function createTupe(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_tupe_transfers
       (home_id, transfer_type, transfer_date, signed_date, transferor_name, transferee_name,
        employees, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${COLS}`,
    [homeId, data.transfer_type, data.transfer_date, data.signed_date || null,
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
    'transfer_type', 'transfer_date', 'signed_date', 'transferor_name', 'transferee_name', 'employees',
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
    `UPDATE hr_tupe_transfers SET ${fields.join(', ')} ${where} RETURNING ${COLS}`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeTupe(rows[0]);
}
