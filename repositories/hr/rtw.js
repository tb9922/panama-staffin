import { pool, createShaper, paginate } from './shared.js';
import { decrypt, encrypt } from '../../services/encryptionService.js';
import logger from '../../logger.js';

const COLS = `id, home_id, staff_id,
  absence_start_date, absence_end_date, absence_days, absence_reason,
  rtw_date, rtw_conducted_by, fit_to_return, adjustments_needed,
  adjustments_detail, underlying_condition, oh_referral_recommended, follow_up_date, notes,
  fit_note_received, fit_note_date, fit_note_type, fit_note_adjustments, fit_note_review_date,
  bradford_score_after, trigger_reached, action_taken, linked_case_id,
  created_by, created_at, updated_at, deleted_at, version`;

const SELECT_COLS = `${COLS}, sensitive_encrypted, sensitive_iv, sensitive_tag`;

const SENSITIVE_FIELDS = [
  'absence_reason',
  'adjustments_detail',
  'underlying_condition',
  'notes',
  'fit_note_type',
  'fit_note_adjustments',
];

const baseShapeRtw = createShaper({
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
});

function normalizeSensitivePayload(payload = {}) {
  return {
    absence_reason: payload.absence_reason || null,
    adjustments_detail: payload.adjustments_detail || null,
    underlying_condition: payload.underlying_condition === true,
    notes: payload.notes || null,
    fit_note_type: payload.fit_note_type || null,
    fit_note_adjustments: payload.fit_note_adjustments || null,
  };
}

function legacySensitivePayload(row) {
  return normalizeSensitivePayload({
    absence_reason: row.absence_reason,
    adjustments_detail: row.adjustments_detail,
    underlying_condition: row.underlying_condition,
    notes: row.notes,
    fit_note_type: row.fit_note_type,
    fit_note_adjustments: row.fit_note_adjustments,
  });
}

function hasSensitiveContent(payload) {
  return Boolean(
    payload.absence_reason
    || payload.adjustments_detail
    || payload.underlying_condition
    || payload.notes
    || payload.fit_note_type
    || payload.fit_note_adjustments
  );
}

function readSensitivePayload(row) {
  const legacy = legacySensitivePayload(row);
  if (!row?.sensitive_encrypted || !row?.sensitive_iv || !row?.sensitive_tag) return legacy;
  try {
    const json = decrypt(row.sensitive_encrypted, row.sensitive_iv, row.sensitive_tag);
    const parsed = json ? JSON.parse(json) : {};
    return { ...legacy, ...normalizeSensitivePayload(parsed) };
  } catch (err) {
    logger.error({ err: err?.message, rtwId: row?.id }, 'Failed to decrypt HR RTW sensitive payload');
    throw Object.assign(new Error('Unable to read encrypted HR RTW data'), { statusCode: 500 });
  }
}

function getSensitiveOverrides(data) {
  const overrides = {};
  for (const key of SENSITIVE_FIELDS) {
    if (!(key in data)) continue;
    overrides[key] = key === 'underlying_condition' ? data[key] === true : data[key] ?? null;
  }
  return overrides;
}

function serializeSensitivePayload(payload) {
  if (!hasSensitiveContent(payload)) return { encrypted: null, iv: null, tag: null };
  const { encrypted, iv, tag } = encrypt(JSON.stringify(payload));
  return { encrypted, iv, tag };
}

function shapeRtw(row) {
  if (!row) return null;
  const out = baseShapeRtw(row);
  const sensitive = readSensitivePayload(row);
  for (const key of SENSITIVE_FIELDS) out[key] = sensitive[key];
  out.conducted_by = out.rtw_conducted_by;
  out.fit_for_work = out.fit_to_return;
  out.adjustments = out.adjustments_detail;
  out.referral_needed = out.oh_referral_recommended;
  return out;
}

async function findRawRtwById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${SELECT_COLS} FROM hr_rtw_interviews WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] || null;
}

export async function findRtwInterviewById(id, homeId, client) {
  return shapeRtw(await findRawRtwById(id, homeId, client));
}

export async function findRtwInterviews(homeId, { staffId } = {}, client, pag) {
  const conn = client || pool;
  let sql = `SELECT ${SELECT_COLS} FROM hr_rtw_interviews WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (staffId) { params.push(staffId); sql += ` AND staff_id = $${params.length}`; }
  return paginate(conn, sql, params, 'rtw_date DESC', shapeRtw, pag);
}

export async function createRtwInterview(homeId, data, client) {
  const conn = client || pool;
  const encrypted = serializeSensitivePayload(normalizeSensitivePayload(data));
  const { rows } = await conn.query(
    `INSERT INTO hr_rtw_interviews
       (home_id, staff_id, absence_start_date, absence_end_date, absence_days, absence_reason,
         rtw_date, rtw_conducted_by, fit_to_return, adjustments_needed, adjustments_detail,
         underlying_condition, oh_referral_recommended, follow_up_date, notes,
         fit_note_received, fit_note_date, fit_note_type, fit_note_adjustments, fit_note_review_date,
         bradford_score_after, trigger_reached, action_taken, created_by,
         sensitive_encrypted, sensitive_iv, sensitive_tag)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
     RETURNING ${SELECT_COLS}`,
    [homeId, data.staff_id, data.absence_start_date, data.absence_end_date || null,
      data.absence_days ?? null, null,
      data.rtw_date, data.rtw_conducted_by, data.fit_to_return ?? true,
      data.adjustments_needed ?? false, null,
      false, data.oh_referral_recommended ?? false,
      data.follow_up_date || null, null, data.fit_note_received ?? false, data.fit_note_date || null,
      null, null, data.fit_note_review_date || null,
      data.bradford_score_after ?? null, data.trigger_reached || null, data.action_taken || null,
      data.created_by || null, encrypted.encrypted, encrypted.iv, encrypted.tag]
  );
  return shapeRtw(rows[0]);
}

export async function updateRtwInterview(id, homeId, data, client, version) {
  const conn = client || pool;
  const existing = await findRawRtwById(id, homeId, conn);
  if (!existing) return version != null ? null : findRtwInterviewById(id, homeId, conn);

  const fields = [];
  const params = [id, homeId];
  const settable = [
    'absence_start_date', 'rtw_date', 'rtw_conducted_by',
    'absence_end_date', 'absence_days', 'fit_to_return',
    'adjustments_needed', 'oh_referral_recommended', 'follow_up_date',
    'fit_note_received', 'fit_note_date', 'fit_note_review_date',
    'bradford_score_after', 'trigger_reached', 'action_taken', 'linked_case_id',
  ];
  for (const key of settable) {
    if (key in data) { params.push(data[key] ?? null); fields.push(`${key} = $${params.length}`); }
  }

  const sensitiveOverrides = getSensitiveOverrides(data);
  if (Object.keys(sensitiveOverrides).length > 0) {
    const mergedSensitive = normalizeSensitivePayload({
      ...readSensitivePayload(existing),
      ...sensitiveOverrides,
    });
    const encrypted = serializeSensitivePayload(mergedSensitive);
    for (const [key, value] of [
      ['absence_reason', null],
      ['adjustments_detail', null],
      ['underlying_condition', false],
      ['notes', null],
      ['fit_note_type', null],
      ['fit_note_adjustments', null],
      ['sensitive_encrypted', encrypted.encrypted],
      ['sensitive_iv', encrypted.iv],
      ['sensitive_tag', encrypted.tag],
    ]) {
      params.push(value);
      fields.push(`${key} = $${params.length}`);
    }
  }

  if (fields.length === 0) return findRtwInterviewById(id, homeId, client);
  fields.push('version = version + 1');
  fields.push('updated_at = NOW()');
  let where = 'WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) { params.push(version); where += ` AND version = $${params.length}`; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_rtw_interviews SET ${fields.join(', ')} ${where} RETURNING ${SELECT_COLS}`,
    params
  );
  if (rowCount === 0 && version != null) return null;
  return shapeRtw(rows[0]);
}
