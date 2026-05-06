import { pool, createShaper, paginate } from './shared.js';
import { decrypt, encrypt } from '../../services/encryptionService.js';
import logger from '../../logger.js';

const COLS = `id, home_id, staff_id,
  referral_date, referred_by, reason, questions_for_oh,
  employee_consent_obtained, consent_date, consent_method, consent_witness, oh_provider, appointment_date,
  report_received_date, report_summary, fit_for_role, adjustments_recommended,
  estimated_return_date, disability_likely, follow_up_date, adjustments_implemented,
  notes, status, created_by, created_at, updated_at, deleted_at, version`;

const SELECT_COLS = `${COLS}, sensitive_encrypted, sensitive_iv, sensitive_tag`;

const SENSITIVE_FIELDS = [
  'reason',
  'questions_for_oh',
  'report_summary',
  'fit_for_role',
  'adjustments_recommended',
  'estimated_return_date',
  'disability_likely',
  'adjustments_implemented',
  'notes',
];

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item));
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map((item) => String(item));
    } catch {
      return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeSensitivePayload(payload = {}) {
  return {
    reason: payload.reason || null,
    questions_for_oh: normalizeJsonArray(payload.questions_for_oh),
    report_summary: payload.report_summary || null,
    fit_for_role: payload.fit_for_role || null,
    adjustments_recommended: payload.adjustments_recommended || null,
    estimated_return_date: payload.estimated_return_date || null,
    disability_likely: payload.disability_likely || null,
    adjustments_implemented: normalizeJsonArray(payload.adjustments_implemented),
    notes: payload.notes || null,
  };
}

function legacySensitivePayload(row) {
  return normalizeSensitivePayload({
    reason: row.reason === '[encrypted]' ? null : row.reason,
    questions_for_oh: row.questions_for_oh,
    report_summary: row.report_summary,
    fit_for_role: row.fit_for_role,
    adjustments_recommended: row.adjustments_recommended,
    estimated_return_date: row.estimated_return_date,
    disability_likely: row.disability_likely,
    adjustments_implemented: row.adjustments_implemented,
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
  const legacy = legacySensitivePayload(row);
  if (!row?.sensitive_encrypted || !row?.sensitive_iv || !row?.sensitive_tag) return legacy;
  try {
    const json = decrypt(row.sensitive_encrypted, row.sensitive_iv, row.sensitive_tag);
    const parsed = json ? JSON.parse(json) : {};
    return { ...legacy, ...normalizeSensitivePayload(parsed) };
  } catch (err) {
    logger.error({ err: err?.message, ohId: row?.id }, 'Failed to decrypt HR OH sensitive payload');
    throw Object.assign(new Error('Unable to read encrypted HR OH data'), { statusCode: 500 });
  }
}

function getSensitiveOverrides(data) {
  const overrides = {};
  for (const key of SENSITIVE_FIELDS) {
    if (!(key in data)) continue;
    overrides[key] = key === 'questions_for_oh' || key === 'adjustments_implemented'
      ? normalizeJsonArray(data[key])
      : data[key] ?? null;
  }
  return overrides;
}

function serializeSensitivePayload(payload) {
  if (!hasSensitiveContent(payload)) return { encrypted: null, iv: null, tag: null };
  const { encrypted, iv, tag } = encrypt(JSON.stringify(payload));
  return { encrypted, iv, tag };
}

const baseShapeOh = createShaper({
  fields: [
    'id', 'home_id', 'staff_id',
    'referral_date', 'referred_by', 'reason', 'questions_for_oh',
    'employee_consent_obtained', 'consent_date', 'consent_method', 'consent_witness', 'oh_provider', 'appointment_date',
    'report_received_date', 'report_summary', 'fit_for_role', 'adjustments_recommended',
    'estimated_return_date', 'disability_likely', 'follow_up_date', 'adjustments_implemented',
    'notes', 'status', 'created_by', 'created_at', 'updated_at', 'version',
  ],
  dates: ['referral_date', 'consent_date', 'appointment_date', 'report_received_date', 'estimated_return_date', 'follow_up_date'],
  jsonArrays: ['questions_for_oh', 'adjustments_implemented'],
});

function shapeOh(row) {
  if (!row) return null;
  const out = baseShapeOh(row);
  const sensitive = readSensitivePayload(row);
  for (const key of SENSITIVE_FIELDS) out[key] = sensitive[key];
  out.provider = out.oh_provider;
  out.report_date = out.report_received_date;
  out.recommendations = out.adjustments_recommended;
  out.report_received = Boolean(out.report_received_date);
  return out;
}

async function findRawOhById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${SELECT_COLS} FROM hr_oh_referrals WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] || null;
}

export async function findOhReferralById(id, homeId, client) {
  return shapeOh(await findRawOhById(id, homeId, client));
}

export async function findOhReferrals(homeId, { staffId, status } = {}, client, pag) {
  const conn = client || pool;
  let sql = `SELECT ${SELECT_COLS} FROM hr_oh_referrals WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  return paginate(conn, sql, params, 'referral_date DESC', shapeOh, pag);
}

export async function createOhReferral(homeId, data, client) {
  const conn = client || pool;
  const encrypted = serializeSensitivePayload(normalizeSensitivePayload(data));
  const { rows } = await conn.query(
    `INSERT INTO hr_oh_referrals
       (home_id, staff_id, referral_date, referred_by, reason, questions_for_oh,
         employee_consent_obtained, consent_date, consent_method, consent_witness, oh_provider, appointment_date,
         report_received_date, report_summary, fit_for_role, adjustments_recommended,
         estimated_return_date, disability_likely, follow_up_date, status, notes, created_by,
         sensitive_encrypted, sensitive_iv, sensitive_tag)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     RETURNING ${SELECT_COLS}`,
    [homeId, data.staff_id, data.referral_date, data.referred_by,
      '[encrypted]', JSON.stringify([]),
      data.employee_consent_obtained ?? false, data.consent_date || null,
      data.consent_method || null, data.consent_witness || null,
      data.oh_provider || null, data.appointment_date || null,
      data.report_received_date || null, null, null,
      null, null, null, data.follow_up_date || null,
      data.status ?? 'pending', null, data.created_by || null,
      encrypted.encrypted, encrypted.iv, encrypted.tag]
  );
  return shapeOh(rows[0]);
}

export async function updateOhReferral(id, homeId, data, client, version) {
  const conn = client || pool;
  const existing = await findRawOhById(id, homeId, conn);
  if (!existing) return version != null ? null : findOhReferralById(id, homeId, conn);

  const fields = [];
  const params = [id, homeId];
  const settable = [
    'referral_date', 'referred_by',
    'employee_consent_obtained', 'consent_date', 'consent_method', 'consent_witness', 'oh_provider', 'appointment_date', 'status',
    'report_received_date', 'follow_up_date',
  ];
  for (const key of settable) {
    if (key in data) {
      params.push(data[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
  }

  const sensitiveOverrides = getSensitiveOverrides(data);
  if (Object.keys(sensitiveOverrides).length > 0) {
    const mergedSensitive = normalizeSensitivePayload({
      ...readSensitivePayload(existing),
      ...sensitiveOverrides,
    });
    const encrypted = serializeSensitivePayload(mergedSensitive);
    for (const [key, value] of [
      ['reason', '[encrypted]'],
      ['questions_for_oh', JSON.stringify([])],
      ['report_summary', null],
      ['fit_for_role', null],
      ['adjustments_recommended', null],
      ['estimated_return_date', null],
      ['disability_likely', null],
      ['adjustments_implemented', JSON.stringify([])],
      ['notes', null],
      ['sensitive_encrypted', encrypted.encrypted],
      ['sensitive_iv', encrypted.iv],
      ['sensitive_tag', encrypted.tag],
    ]) {
      params.push(value);
      fields.push(`${key} = $${params.length}`);
    }
  }

  if (fields.length === 0) return findOhReferralById(id, homeId, client);
  fields.push('version = version + 1');
  fields.push('updated_at = NOW()');
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_oh_referrals SET ${fields.join(', ')} ${where} RETURNING ${SELECT_COLS}`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeOh(rows[0]);
}
