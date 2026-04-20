import { pool, createShaper, paginate } from './shared.js';
import { decrypt, encrypt } from '../../services/encryptionService.js';
import logger from '../../logger.js';

const COLS = `id, home_id, record_type, staff_id,
  complaint_date, harassment_category, third_party, third_party_type,
  respondent_type, respondent_staff_id, respondent_name,
  handling_route, linked_case_id, reasonable_steps_evidence,
  condition_description, adjustments, oh_referral_id,
  access_to_work_applied, access_to_work_reference, access_to_work_amount,
  description, status, outcome, notes,
  created_at, updated_at, deleted_at, version`;

const SELECT_COLS = `${COLS}, sensitive_encrypted, sensitive_iv, sensitive_tag`;

const SENSITIVE_FIELDS = [
  'harassment_category',
  'respondent_name',
  'reasonable_steps_evidence',
  'condition_description',
  'adjustments',
  'access_to_work_reference',
  'description',
  'outcome',
  'notes',
];

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item));
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(Boolean).map((item) => String(item));
      }
    } catch {
      // Fall back to newline-delimited legacy strings.
    }
    return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeSensitivePayload(payload = {}) {
  return {
    harassment_category: payload.harassment_category || null,
    respondent_name: payload.respondent_name || null,
    reasonable_steps_evidence: normalizeJsonArray(payload.reasonable_steps_evidence),
    condition_description: payload.condition_description || null,
    adjustments: normalizeJsonArray(payload.adjustments),
    access_to_work_reference: payload.access_to_work_reference || null,
    description: payload.description || null,
    outcome: payload.outcome || null,
    notes: payload.notes || null,
  };
}

function buildLegacySensitive(row) {
  return normalizeSensitivePayload({
    harassment_category: row.harassment_category,
    respondent_name: row.respondent_name,
    reasonable_steps_evidence: row.reasonable_steps_evidence,
    condition_description: row.condition_description,
    adjustments: row.adjustments,
    access_to_work_reference: row.access_to_work_reference,
    description: row.description,
    outcome: row.outcome,
    notes: row.notes,
  });
}

function hasSensitiveContent(payload) {
  return Object.values(payload).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  });
}

function readSensitivePayload(row) {
  const legacy = buildLegacySensitive(row);
  if (!row?.sensitive_encrypted || !row?.sensitive_iv || !row?.sensitive_tag) {
    return legacy;
  }
  try {
    const json = decrypt(row.sensitive_encrypted, row.sensitive_iv, row.sensitive_tag);
    const parsed = json ? JSON.parse(json) : {};
    return { ...legacy, ...normalizeSensitivePayload(parsed) };
  } catch (err) {
    logger.error({ err: err?.message, ediId: row?.id }, 'Failed to decrypt HR EDI sensitive payload');
    throw Object.assign(new Error('Unable to read encrypted HR EDI data'), { statusCode: 500 });
  }
}

function getSensitiveOverrides(data) {
  const overrides = {};
  for (const key of SENSITIVE_FIELDS) {
    if (!(key in data)) continue;
    if (key === 'reasonable_steps_evidence' || key === 'adjustments') {
      overrides[key] = normalizeJsonArray(data[key]);
    } else {
      overrides[key] = data[key] ?? null;
    }
  }
  return overrides;
}

function serializeSensitivePayload(payload) {
  if (!hasSensitiveContent(payload)) {
    return { encrypted: null, iv: null, tag: null };
  }
  const { encrypted, iv, tag } = encrypt(JSON.stringify(payload));
  return { encrypted, iv, tag };
}

const baseShape = createShaper({
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
});

function shapeEdi(row) {
  if (!row) return null;
  const out = baseShape(row);
  const sensitive = readSensitivePayload(row);
  out.harassment_category = sensitive.harassment_category;
  out.respondent_name = sensitive.respondent_name;
  out.reasonable_steps_evidence = sensitive.reasonable_steps_evidence;
  out.condition_description = sensitive.condition_description;
  out.adjustments = sensitive.adjustments;
  out.access_to_work_reference = sensitive.access_to_work_reference;
  out.description = sensitive.description;
  out.outcome = sensitive.outcome;
  out.notes = sensitive.notes;
  out.date_recorded = out.complaint_date;
  out.respondent_role = out.respondent_type;
  out.category = out.record_type === 'reasonable_adjustment' ? (out.description || null) : out.harassment_category;
  return out;
}

async function findRawById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${SELECT_COLS} FROM hr_edi_records WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] || null;
}

export async function findEdi(homeId, { recordType, staffId } = {}, client, pag) {
  const conn = client || pool;
  let sql = `SELECT ${SELECT_COLS} FROM hr_edi_records WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (recordType) { params.push(recordType); sql += ` AND record_type = $${params.length}`; }
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  return paginate(conn, sql, params, 'created_at DESC', shapeEdi, pag);
}

export async function findEdiById(id, homeId, client) {
  const row = await findRawById(id, homeId, client);
  return shapeEdi(row);
}

export async function createEdi(homeId, data, client) {
  const conn = client || pool;
  const sensitive = normalizeSensitivePayload({
    harassment_category: data.harassment_category,
    respondent_name: data.respondent_name,
    reasonable_steps_evidence: data.reasonable_steps_evidence,
    condition_description: data.condition_description,
    adjustments: data.adjustments,
    access_to_work_reference: data.access_to_work_reference,
    description: data.description,
    outcome: data.outcome,
    notes: data.notes,
  });
  const encrypted = serializeSensitivePayload(sensitive);
  const { rows } = await conn.query(
    `INSERT INTO hr_edi_records
       (home_id, record_type, staff_id, complaint_date, harassment_category,
        third_party, third_party_type, respondent_type, respondent_staff_id, respondent_name,
        handling_route, linked_case_id, reasonable_steps_evidence,
        condition_description, adjustments, oh_referral_id,
        access_to_work_applied, access_to_work_reference, access_to_work_amount,
        description, status, outcome, notes, created_by,
        sensitive_encrypted, sensitive_iv, sensitive_tag)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
     RETURNING ${SELECT_COLS}`,
    [
      homeId,
      data.record_type,
      data.staff_id || null,
      data.complaint_date || null,
      null,
      data.third_party ?? false,
      data.third_party_type || null,
      data.respondent_type || null,
      data.respondent_staff_id || null,
      null,
      data.handling_route || null,
      data.linked_case_id || null,
      JSON.stringify([]),
      null,
      JSON.stringify([]),
      data.oh_referral_id || null,
      data.access_to_work_applied ?? false,
      null,
      data.access_to_work_amount ?? null,
      null,
      data.status ?? 'open',
      null,
      null,
      data.created_by || null,
      encrypted.encrypted,
      encrypted.iv,
      encrypted.tag,
    ]
  );
  return shapeEdi(rows[0]);
}

export async function updateEdi(id, homeId, data, client, version) {
  const conn = client || pool;
  const existing = await findRawById(id, homeId, conn);
  if (!existing) return version != null ? null : findEdiById(id, homeId, conn);

  const fields = [];
  const params = [id, homeId];
  const settable = [
    'record_type', 'staff_id', 'complaint_date', 'third_party', 'third_party_type',
    'respondent_type', 'respondent_staff_id', 'handling_route', 'linked_case_id',
    'oh_referral_id', 'access_to_work_applied', 'access_to_work_amount', 'status',
  ];

  for (const key of settable) {
    if (!(key in data)) continue;
    params.push(data[key] ?? null);
    fields.push(`${key} = $${params.length}`);
  }

  const mergedSensitive = {
    ...readSensitivePayload(existing),
    ...getSensitiveOverrides(data),
  };
  const encrypted = serializeSensitivePayload(normalizeSensitivePayload(mergedSensitive));
  params.push(null);
  fields.push(`harassment_category = $${params.length}`);
  params.push(null);
  fields.push(`respondent_name = $${params.length}`);
  params.push(JSON.stringify([]));
  fields.push(`reasonable_steps_evidence = $${params.length}`);
  params.push(null);
  fields.push(`condition_description = $${params.length}`);
  params.push(JSON.stringify([]));
  fields.push(`adjustments = $${params.length}`);
  params.push(null);
  fields.push(`access_to_work_reference = $${params.length}`);
  params.push(null);
  fields.push(`description = $${params.length}`);
  params.push(null);
  fields.push(`outcome = $${params.length}`);
  params.push(null);
  fields.push(`notes = $${params.length}`);
  params.push(encrypted.encrypted);
  fields.push(`sensitive_encrypted = $${params.length}`);
  params.push(encrypted.iv);
  fields.push(`sensitive_iv = $${params.length}`);
  params.push(encrypted.tag);
  fields.push(`sensitive_tag = $${params.length}`);

  fields.push('version = version + 1', 'updated_at = NOW()');

  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) {
    params.push(version);
    where += ` AND version = $${params.length}`;
  }

  const { rows, rowCount } = await conn.query(
    `UPDATE hr_edi_records SET ${fields.join(', ')} ${where} RETURNING ${SELECT_COLS}`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeEdi(rows[0]);
}
