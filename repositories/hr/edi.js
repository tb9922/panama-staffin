import { pool, createShaper, paginate } from './shared.js';

const shapeEdi = createShaper({
  fields: [
    'id', 'home_id', 'record_type', 'staff_id',
    'complaint_date', 'harassment_category', 'third_party', 'third_party_type',
    'respondent_type', 'respondent_staff_id', 'respondent_name',
    'handling_route', 'linked_case_id', 'reasonable_steps_evidence',
    'condition_description', 'adjustments', 'oh_referral_id',
    'access_to_work_applied', 'access_to_work_reference', 'access_to_work_amount',
    'description', 'status', 'outcome', 'notes',
    'created_at', 'updated_at', 'version',
  ],
  dates: ['complaint_date'],
  floats: ['access_to_work_amount'],
  jsonArrays: ['reasonable_steps_evidence', 'adjustments'],
  aliases: { date_recorded: 'complaint_date', category: 'harassment_category', respondent_role: 'respondent_type' },
});

export async function findEdi(homeId, { recordType, staffId } = {}, client, pag) {
  const conn = client || pool;
  let sql = 'SELECT * FROM hr_edi_records WHERE home_id = $1 AND deleted_at IS NULL';
  const params = [homeId];
  if (recordType) { params.push(recordType); sql += ` AND record_type = $${params.length}`; }
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  return paginate(conn, sql, params, 'created_at DESC', shapeEdi, pag);
}

export async function findEdiById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM hr_edi_records WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL', [id, homeId]);
  return shapeEdi(rows[0]);
}

export async function createEdi(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_edi_records
       (home_id, record_type, staff_id, complaint_date, harassment_category,
        third_party, third_party_type, respondent_type, respondent_staff_id, respondent_name,
        handling_route, condition_description, adjustments, description, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [homeId, data.record_type, data.staff_id || null, data.complaint_date || null,
     data.harassment_category || null, data.third_party ?? false,
     data.third_party_type || null, data.respondent_type || null,
     data.respondent_staff_id || null, data.respondent_name || null,
     data.handling_route || null, data.condition_description || null,
     JSON.stringify(data.adjustments || []), data.description || null,
     data.status ?? 'open']
  );
  return shapeEdi(rows[0]);
}

export async function updateEdi(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'record_type', 'complaint_date', 'harassment_category', 'third_party', 'third_party_type',
    'respondent_type', 'respondent_staff_id', 'respondent_name',
    'handling_route', 'linked_case_id', 'reasonable_steps_evidence',
    'condition_description', 'adjustments', 'oh_referral_id',
    'access_to_work_applied', 'access_to_work_reference', 'access_to_work_amount',
    'description', 'status', 'outcome', 'notes',
  ];
  const jsonFields = ['reasonable_steps_evidence', 'adjustments'];
  for (const key of settable) {
    if (key in data) {
      params.push(jsonFields.includes(key) ? JSON.stringify(data[key]) : data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  fields.push('version = version + 1');
  if (fields.length === 1) return findEdiById(id, homeId, client);
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_edi_records SET ${fields.join(', ')} ${where} RETURNING *`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeEdi(rows[0]);
}
