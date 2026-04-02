import { pool, createShaper, paginate } from './shared.js';

const COLS = `id, home_id, record_type, staff_id,
  complaint_date, harassment_category, third_party, third_party_type,
  respondent_type, respondent_staff_id, respondent_name,
  handling_route, linked_case_id, reasonable_steps_evidence,
  condition_description, adjustments, oh_referral_id,
  access_to_work_applied, access_to_work_reference, access_to_work_amount,
  description, status, outcome, notes,
  created_at, updated_at, deleted_at, version`;

function stringifyJsonText(value) {
  return JSON.stringify(value ?? '');
}

function normalizeJsonText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join('\n');
  if (value == null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

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
  aliases: {
    reasonable_steps_evidence: (row, out) => normalizeJsonText(out.reasonable_steps_evidence),
    adjustments: (row, out) => normalizeJsonText(out.adjustments),
    date_recorded: 'complaint_date',
    category: (row, out) => out.record_type === 'reasonable_adjustment' ? (out.description || null) : out.harassment_category,
    respondent_role: 'respondent_type',
  },
});

export async function findEdi(homeId, { recordType, staffId } = {}, client, pag) {
  const conn = client || pool;
  let sql = `SELECT ${COLS} FROM hr_edi_records WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (recordType) { params.push(recordType); sql += ` AND record_type = $${params.length}`; }
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  return paginate(conn, sql, params, 'created_at DESC', shapeEdi, pag);
}

export async function findEdiById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_edi_records WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`, [id, homeId]);
  return shapeEdi(rows[0]);
}

export async function createEdi(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_edi_records
       (home_id, record_type, staff_id, complaint_date, harassment_category,
        third_party, third_party_type, respondent_type, respondent_staff_id, respondent_name,
        handling_route, linked_case_id, reasonable_steps_evidence,
        condition_description, adjustments, oh_referral_id,
        access_to_work_applied, access_to_work_reference, access_to_work_amount,
        description, status, outcome, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING ${COLS}`,
    [homeId, data.record_type, data.staff_id || null, data.complaint_date || null,
     data.harassment_category || null, data.third_party ?? false,
     data.third_party_type || null, data.respondent_type || null,
     data.respondent_staff_id || null, data.respondent_name || null,
     data.handling_route || null, data.linked_case_id || null,
     stringifyJsonText(data.reasonable_steps_evidence), data.condition_description || null,
     stringifyJsonText(data.adjustments), data.oh_referral_id || null,
     data.access_to_work_applied ?? false, data.access_to_work_reference || null, data.access_to_work_amount ?? null,
     data.description || null, data.status ?? 'open', data.outcome || null, data.notes || null, data.created_by || null]
  );
  return shapeEdi(rows[0]);
}

export async function updateEdi(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'record_type', 'staff_id', 'complaint_date', 'harassment_category', 'third_party', 'third_party_type',
    'respondent_type', 'respondent_staff_id', 'respondent_name',
    'handling_route', 'linked_case_id', 'reasonable_steps_evidence',
    'condition_description', 'adjustments', 'oh_referral_id',
    'access_to_work_applied', 'access_to_work_reference', 'access_to_work_amount',
    'description', 'status', 'outcome', 'notes',
  ];
  const jsonTextFields = new Set(['reasonable_steps_evidence', 'adjustments']);
  for (const key of settable) {
    if (key in data) {
      params.push(jsonTextFields.has(key) ? stringifyJsonText(data[key]) : data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }
  fields.push('version = version + 1');
  if (fields.length === 1) return findEdiById(id, homeId, client);
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_edi_records SET ${fields.join(', ')} ${where} RETURNING ${COLS}`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeEdi(rows[0]);
}
