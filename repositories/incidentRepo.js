import { pool } from '../db.js';
import { paginateResult } from '../lib/pagination.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';
import { getCqcNotificationDeadline, getCqcNotificationDeadlineKind } from '../shared/incidents.js';

/* Explicit column list — no SELECT * — so future columns don't auto-leak to API consumers. */
const INCIDENT_COLS = `id, home_id, date, time, location, type, severity, description,
  person_affected, person_affected_name, staff_involved, immediate_action,
  medical_attention, hospital_attendance,
  cqc_notifiable, cqc_notification_type, cqc_notification_deadline,
  cqc_notified, cqc_notified_date, cqc_notified_time, cqc_reference,
  riddor_reportable, riddor_category, riddor_reported, riddor_reported_date, riddor_reported_time, riddor_reference,
  safeguarding_referral, safeguarding_to, safeguarding_reference, safeguarding_date,
  witnesses, duty_of_candour_applies, candour_notification_date, candour_letter_sent_date, candour_recipient,
  police_involved, police_reference, police_contact_date,
  msp_wishes_recorded, msp_outcome_preferences, msp_person_involved,
  investigation_status, investigation_start_date, investigation_lead,
  investigation_review_date, root_cause, lessons_learned, investigation_closed_date,
  corrective_actions, reported_by, reported_at, updated_at, frozen_at, version`;

const ADDENDUM_COLS = 'id, incident_id, home_id, author, content, created_at';

const CQC_DEADLINE_KINDS = new Set(['without_delay', 'immediate', '72h']);

function normalizeTimeStr(value) {
  return typeof value === 'string' ? value.slice(0, 5) : value || null;
}

function normalizeStoredCqcDeadline(data) {
  const raw = data?.cqc_notification_deadline;
  if (raw && !CQC_DEADLINE_KINDS.has(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (!data?.cqc_notifiable || !data?.date) return null;
  const { deadline } = getCqcNotificationDeadline(data);
  return deadline instanceof Date && !Number.isNaN(deadline.getTime()) ? deadline.toISOString() : null;
}

function shapeRow(row) {
  return {
    id: row.id, version: row.version != null ? parseInt(row.version, 10) : undefined,
    date: row.date, time: normalizeTimeStr(row.time), location: row.location, type: row.type, severity: row.severity,
    description: row.description, person_affected: row.person_affected, person_affected_name: row.person_affected_name,
    staff_involved: row.staff_involved, immediate_action: row.immediate_action,
    medical_attention: row.medical_attention, hospital_attendance: row.hospital_attendance,
    cqc_notifiable: row.cqc_notifiable, cqc_notification_type: row.cqc_notification_type,
    cqc_notification_deadline: getCqcNotificationDeadlineKind(row),
    cqc_notified: row.cqc_notified, cqc_notified_date: row.cqc_notified_date, cqc_notified_time: normalizeTimeStr(row.cqc_notified_time), cqc_reference: row.cqc_reference,
    riddor_reportable: row.riddor_reportable, riddor_category: row.riddor_category,
    riddor_reported: row.riddor_reported, riddor_reported_date: row.riddor_reported_date, riddor_reported_time: normalizeTimeStr(row.riddor_reported_time), riddor_reference: row.riddor_reference,
    safeguarding_referral: row.safeguarding_referral, safeguarding_to: row.safeguarding_to,
    safeguarding_reference: row.safeguarding_reference, safeguarding_date: row.safeguarding_date,
    witnesses: row.witnesses,
    duty_of_candour_applies: row.duty_of_candour_applies,
    candour_notification_date: row.candour_notification_date, candour_letter_sent_date: row.candour_letter_sent_date,
    candour_recipient: row.candour_recipient,
    police_involved: row.police_involved, police_reference: row.police_reference, police_contact_date: row.police_contact_date,
    msp_wishes_recorded: row.msp_wishes_recorded, msp_outcome_preferences: row.msp_outcome_preferences,
    msp_person_involved: row.msp_person_involved,
    investigation_status: row.investigation_status, investigation_start_date: row.investigation_start_date,
    investigation_lead: row.investigation_lead, investigation_review_date: row.investigation_review_date,
    root_cause: row.root_cause, lessons_learned: row.lessons_learned, investigation_closed_date: row.investigation_closed_date,
    corrective_actions: row.corrective_actions, reported_by: row.reported_by,
    reported_at: toIsoOrNull(row.reported_at), updated_at: toIsoOrNull(row.updated_at), frozen_at: toIsoOrNull(row.frozen_at),
  };
}

/**
 * Return all non-deleted incidents for a home (paginated).
 * @param {number} homeId
 * @param {{ limit?: number, offset?: number }} [opts]
 */
export async function findByHome(homeId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT ${INCIDENT_COLS}, COUNT(*) OVER() AS _total FROM incidents
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY date DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  return paginateResult(rows, shapeRow);
}

/**
 * Sync incidents. Upserts all incoming, soft-deletes removed records.
 * @param {number} homeId
 * @param {Array} incidentsArr
 * @param {object} [client]
 */
export async function sync(homeId, incidentsArr, client) {
  const conn = client || pool;
  // An empty array often means the frontend has not loaded records yet.
  // Treating that as "delete everything" is too destructive.
  if (!incidentsArr || incidentsArr.length === 0) return;

  const incomingIds = incidentsArr.map(i => i.id);

  // Batch upsert — keep well within PG parameter limits while preserving explicit column order.
  const CHUNK = 25;
  for (let i = 0; i < incidentsArr.length; i += CHUNK) {
    const chunk = incidentsArr.slice(i, i + CHUNK);
    const rowValues = chunk.map((inc) => ([
      inc.id,
      inc.date || null,
      normalizeTimeStr(inc.time),
      inc.location || null,
      inc.type || null,
      inc.severity || null,
      inc.description || null,
      inc.person_affected || null,
      inc.person_affected_name || null,
      JSON.stringify(inc.staff_involved || []),
      inc.immediate_action || null,
      inc.medical_attention ?? null,
      inc.hospital_attendance ?? null,
      inc.cqc_notifiable ?? false,
      inc.cqc_notification_type || null,
      normalizeStoredCqcDeadline(inc),
      inc.cqc_notified ?? false,
      inc.cqc_notified_date || null,
      normalizeTimeStr(inc.cqc_notified_time),
      inc.cqc_reference || null,
      inc.riddor_reportable ?? false,
      inc.riddor_category || null,
      inc.riddor_reported ?? false,
      inc.riddor_reported_date || null,
      normalizeTimeStr(inc.riddor_reported_time),
      inc.riddor_reference || null,
      inc.safeguarding_referral ?? false,
      inc.safeguarding_to || null,
      inc.safeguarding_reference || null,
      inc.safeguarding_date || null,
      JSON.stringify(inc.witnesses || []),
      inc.duty_of_candour_applies ?? false,
      inc.candour_notification_date || null,
      inc.candour_letter_sent_date || null,
      inc.candour_recipient || null,
      inc.police_involved ?? false,
      inc.police_reference || null,
      inc.police_contact_date || null,
      inc.msp_wishes_recorded ?? false,
      inc.msp_outcome_preferences || null,
      inc.msp_person_involved ?? null,
      inc.investigation_status ?? 'open',
      inc.investigation_start_date || null,
      inc.investigation_lead || null,
      inc.investigation_review_date || null,
      inc.root_cause || null,
      inc.lessons_learned || null,
      inc.investigation_closed_date || null,
      JSON.stringify(inc.corrective_actions || []),
      inc.reported_by || null,
      inc.reported_at || null,
    ]));
    const colsPerRow = rowValues[0].length;
    const placeholders = rowValues.map((_, rowIndex) => {
      const start = rowIndex * colsPerRow + 2; // $1 is homeId
      const rest = Array.from({ length: colsPerRow - 1 }, (_unused, valueIndex) => `$${start + valueIndex + 1}`);
      return `($${start},$1,${rest.join(',')},NOW())`;
    });
    const values = rowValues.flat();
    await conn.query(
      `INSERT INTO incidents (
         id, home_id, date, time, location, type, severity, description,
         person_affected, person_affected_name, staff_involved, immediate_action,
         medical_attention, hospital_attendance,
         cqc_notifiable, cqc_notification_type, cqc_notification_deadline,
         cqc_notified, cqc_notified_date, cqc_notified_time, cqc_reference,
         riddor_reportable, riddor_category, riddor_reported, riddor_reported_date, riddor_reported_time, riddor_reference,
         safeguarding_referral, safeguarding_to, safeguarding_reference, safeguarding_date,
         witnesses, duty_of_candour_applies, candour_notification_date, candour_letter_sent_date, candour_recipient,
         police_involved, police_reference, police_contact_date,
         msp_wishes_recorded, msp_outcome_preferences, msp_person_involved,
         investigation_status, investigation_start_date, investigation_lead,
         investigation_review_date, root_cause, lessons_learned, investigation_closed_date,
         corrective_actions, reported_by, reported_at, updated_at
       ) VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, id) DO UPDATE SET
         date                      = EXCLUDED.date,
         time                      = EXCLUDED.time,
         location                  = EXCLUDED.location,
         type                      = EXCLUDED.type,
         severity                  = EXCLUDED.severity,
         description               = EXCLUDED.description,
         person_affected           = EXCLUDED.person_affected,
         person_affected_name      = EXCLUDED.person_affected_name,
         staff_involved            = EXCLUDED.staff_involved,
         immediate_action          = EXCLUDED.immediate_action,
         medical_attention         = EXCLUDED.medical_attention,
         hospital_attendance       = EXCLUDED.hospital_attendance,
         cqc_notifiable            = EXCLUDED.cqc_notifiable,
         cqc_notification_type     = EXCLUDED.cqc_notification_type,
         cqc_notification_deadline = EXCLUDED.cqc_notification_deadline,
         cqc_notified              = EXCLUDED.cqc_notified,
         cqc_notified_date         = EXCLUDED.cqc_notified_date,
         cqc_notified_time         = EXCLUDED.cqc_notified_time,
         cqc_reference             = EXCLUDED.cqc_reference,
         riddor_reportable         = EXCLUDED.riddor_reportable,
         riddor_category           = EXCLUDED.riddor_category,
         riddor_reported           = EXCLUDED.riddor_reported,
         riddor_reported_date      = EXCLUDED.riddor_reported_date,
         riddor_reported_time      = EXCLUDED.riddor_reported_time,
         riddor_reference          = EXCLUDED.riddor_reference,
         safeguarding_referral     = EXCLUDED.safeguarding_referral,
         safeguarding_to           = EXCLUDED.safeguarding_to,
         safeguarding_reference    = EXCLUDED.safeguarding_reference,
         safeguarding_date         = EXCLUDED.safeguarding_date,
         witnesses                 = EXCLUDED.witnesses,
         duty_of_candour_applies   = EXCLUDED.duty_of_candour_applies,
         candour_notification_date = EXCLUDED.candour_notification_date,
         candour_letter_sent_date  = EXCLUDED.candour_letter_sent_date,
         candour_recipient         = EXCLUDED.candour_recipient,
         police_involved           = EXCLUDED.police_involved,
         police_reference          = EXCLUDED.police_reference,
         police_contact_date       = EXCLUDED.police_contact_date,
         msp_wishes_recorded       = EXCLUDED.msp_wishes_recorded,
         msp_outcome_preferences   = EXCLUDED.msp_outcome_preferences,
         msp_person_involved       = EXCLUDED.msp_person_involved,
         investigation_status      = EXCLUDED.investigation_status,
         investigation_start_date  = EXCLUDED.investigation_start_date,
         investigation_lead        = EXCLUDED.investigation_lead,
         investigation_review_date = EXCLUDED.investigation_review_date,
         root_cause                = EXCLUDED.root_cause,
         lessons_learned           = EXCLUDED.lessons_learned,
         investigation_closed_date = EXCLUDED.investigation_closed_date,
         corrective_actions        = EXCLUDED.corrective_actions,
         reported_by               = EXCLUDED.reported_by,
         reported_at               = EXCLUDED.reported_at,
         updated_at                = NOW(),
         version                   = incidents.version + 1,
         deleted_at                = CASE WHEN incidents.frozen_at IS NOT NULL THEN incidents.deleted_at ELSE EXCLUDED.deleted_at END
       WHERE incidents.frozen_at IS NULL`,
      [homeId, ...values]
    );
  }

  // Soft-delete records removed from the frontend (skip frozen records)
  await conn.query(
    `UPDATE incidents SET deleted_at = NOW()
     WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL AND frozen_at IS NULL`,
    [homeId, incomingIds]
  );
}

// ── Incident freeze ────────────────────────────────────────────────────────────

/**
 * Freeze an incident. Once frozen, the incident body is immutable.
 * @param {string} incidentId
 * @param {number} homeId
 */
export async function freeze(incidentId, homeId) {
  const { rowCount } = await pool.query(
    `UPDATE incidents SET frozen_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND home_id = $2 AND frozen_at IS NULL AND deleted_at IS NULL`,
    [incidentId, homeId]
  );
  return rowCount > 0;
}

/**
 * Check if an incident is frozen.
 * @param {string} incidentId
 * @param {number} homeId
 * @returns {Promise<boolean>}
 */
export async function isFrozen(incidentId, homeId) {
  const { rows } = await pool.query(
    'SELECT frozen_at FROM incidents WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [incidentId, homeId]
  );
  return rows.length > 0 && rows[0].frozen_at != null;
}

// ── Incident addenda (append-only post-freeze notes) ───────────────────────────

/**
 * Add an addendum to an incident. Works on both frozen and unfrozen incidents.
 * @param {string} incidentId
 * @param {number} homeId
 * @param {string} author
 * @param {string} content
 */
export async function addAddendum(incidentId, homeId, author, content) {
  const { rows } = await pool.query(
    `INSERT INTO incident_addenda (incident_id, home_id, author, content)
     SELECT $1::varchar, $2::integer, $3::varchar, $4::text
     WHERE EXISTS (
       SELECT 1 FROM incidents
       WHERE id = $1::varchar AND home_id = $2::integer AND deleted_at IS NULL
     )
     RETURNING ${ADDENDUM_COLS}`,
    [incidentId, homeId, author, content]
  );
  return rows[0] || null;
}

/**
 * Get all addenda for an incident, oldest first.
 * @param {string} incidentId
 * @param {number} homeId
 */
export async function getAddenda(incidentId, homeId) {
  const { rows } = await pool.query(
    `SELECT id, author, content, created_at
     FROM incident_addenda
     WHERE incident_id = $1 AND home_id = $2
     ORDER BY created_at ASC`,
    [incidentId, homeId]
  );
  return rows;
}

// ── Individual CRUD (Mode 2 endpoints) ────────────────────────────────────────

import { randomUUID } from 'crypto';

export async function findById(id, homeId) {
  const { rows } = await pool.query(
    `SELECT ${INCIDENT_COLS} FROM incidents WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

/**
 * Create or update a single incident.
 * If data.id is provided and the row exists, it updates (unless frozen).
 * If data.id is omitted, a new UUID-based ID is generated.
 */
export async function upsert(homeId, data) {
  const id = data.id || `inc-${randomUUID()}`;
  const now = new Date().toISOString();
  const rowValues = [
    id,
    homeId,
    data.date || null,
    normalizeTimeStr(data.time),
    data.location || null,
    data.type || null,
    data.severity || null,
    data.description || null,
    data.person_affected || null,
    data.person_affected_name || null,
    JSON.stringify(data.staff_involved || []),
    data.immediate_action || null,
    data.medical_attention ?? false,
    data.hospital_attendance ?? false,
    data.cqc_notifiable ?? false,
    data.cqc_notification_type || null,
    normalizeStoredCqcDeadline(data),
    data.cqc_notified ?? false,
    data.cqc_notified_date || null,
    normalizeTimeStr(data.cqc_notified_time),
    data.cqc_reference || null,
    data.riddor_reportable ?? false,
    data.riddor_category || null,
    data.riddor_reported ?? false,
    data.riddor_reported_date || null,
    normalizeTimeStr(data.riddor_reported_time),
    data.riddor_reference || null,
    data.safeguarding_referral ?? false,
    data.safeguarding_to || null,
    data.safeguarding_reference || null,
    data.safeguarding_date || null,
    JSON.stringify(data.witnesses || []),
    data.duty_of_candour_applies ?? false,
    data.candour_notification_date || null,
    data.candour_letter_sent_date || null,
    data.candour_recipient || null,
    data.police_involved ?? false,
    data.police_reference || null,
    data.police_contact_date || null,
    data.msp_wishes_recorded ?? false,
    data.msp_outcome_preferences || null,
    data.msp_person_involved ?? null,
    data.investigation_status ?? 'open',
    data.investigation_start_date || null,
    data.investigation_lead || null,
    data.investigation_review_date || null,
    data.root_cause || null,
    data.lessons_learned || null,
    data.investigation_closed_date || null,
    JSON.stringify(data.corrective_actions || []),
    data.resident_id ?? null,
    data.reported_by || null,
    data.reported_at || now,
    now,
  ];
  const { rows } = await pool.query(
    `INSERT INTO incidents (
       id, home_id, date, time, location, type, severity, description,
       person_affected, person_affected_name, staff_involved, immediate_action,
       medical_attention, hospital_attendance,
       cqc_notifiable, cqc_notification_type, cqc_notification_deadline,
       cqc_notified, cqc_notified_date, cqc_notified_time, cqc_reference,
       riddor_reportable, riddor_category, riddor_reported, riddor_reported_date, riddor_reported_time, riddor_reference,
       safeguarding_referral, safeguarding_to, safeguarding_reference, safeguarding_date,
       witnesses, duty_of_candour_applies, candour_notification_date, candour_letter_sent_date, candour_recipient,
       police_involved, police_reference, police_contact_date,
       msp_wishes_recorded, msp_outcome_preferences, msp_person_involved,
       investigation_status, investigation_start_date, investigation_lead,
       investigation_review_date, root_cause, lessons_learned, investigation_closed_date,
       corrective_actions, resident_id, reported_by, reported_at, updated_at
     ) VALUES (
       ${rowValues.map((_unused, index) => `$${index + 1}`).join(',')}
     )
      ON CONFLICT (home_id, id) DO UPDATE SET
        date=$3,time=$4,location=$5,type=$6,severity=$7,description=$8,
        person_affected=$9,person_affected_name=$10,staff_involved=$11,immediate_action=$12,
       medical_attention=$13,hospital_attendance=$14,
       cqc_notifiable=$15,cqc_notification_type=$16,cqc_notification_deadline=$17,
       cqc_notified=$18,cqc_notified_date=$19,cqc_notified_time=$20,cqc_reference=$21,
       riddor_reportable=$22,riddor_category=$23,riddor_reported=$24,riddor_reported_date=$25,riddor_reported_time=$26,riddor_reference=$27,
       safeguarding_referral=$28,safeguarding_to=$29,safeguarding_reference=$30,safeguarding_date=$31,
       witnesses=$32,duty_of_candour_applies=$33,candour_notification_date=$34,candour_letter_sent_date=$35,candour_recipient=$36,
       police_involved=$37,police_reference=$38,police_contact_date=$39,
        msp_wishes_recorded=$40,msp_outcome_preferences=$41,msp_person_involved=$42,
        investigation_status=$43,investigation_start_date=$44,investigation_lead=$45,
        investigation_review_date=$46,root_cause=$47,lessons_learned=$48,investigation_closed_date=$49,
        corrective_actions=$50,resident_id=$51,reported_by=$52,reported_at=$53,updated_at=$54,
        version = incidents.version + 1,
        deleted_at=NULL
      WHERE incidents.frozen_at IS NULL
      RETURNING ${INCIDENT_COLS}`,
    rowValues
  );
  // Auto-resolve resident_id for resident-type incidents
  if (rows[0] && data.person_affected === 'resident' && data.person_affected_name && !data.resident_id) {
    const { rows: fr } = await pool.query(
      `SELECT id FROM finance_residents WHERE home_id = $1 AND resident_name = $2 AND deleted_at IS NULL`,
      [homeId, data.person_affected_name]
    );
    if (fr.length === 1) {
      await pool.query(`UPDATE incidents SET resident_id = $1 WHERE home_id = $2 AND id = $3`, [fr[0].id, homeId, id]);
    }
  }
  return rows[0] ? shapeRow(rows[0]) : null;
}

// Column name whitelist for dynamic SQL
const ALLOWED_COLUMNS = new Set([
  'date', 'time', 'location', 'type', 'severity', 'description',
  'person_affected', 'person_affected_name', 'staff_involved', 'immediate_action',
  'medical_attention', 'hospital_attendance',
  'cqc_notifiable', 'cqc_notification_type', 'cqc_notification_deadline',
  'cqc_notified', 'cqc_notified_date', 'cqc_notified_time', 'cqc_reference',
  'riddor_reportable', 'riddor_category', 'riddor_reported', 'riddor_reported_date', 'riddor_reported_time', 'riddor_reference',
  'safeguarding_referral', 'safeguarding_to', 'safeguarding_reference', 'safeguarding_date',
  'witnesses', 'duty_of_candour_applies', 'candour_notification_date', 'candour_letter_sent_date', 'candour_recipient',
  'police_involved', 'police_reference', 'police_contact_date',
  'msp_wishes_recorded', 'msp_outcome_preferences', 'msp_person_involved',
  'investigation_status', 'investigation_start_date', 'investigation_lead',
  'investigation_review_date', 'root_cause', 'lessons_learned', 'investigation_closed_date',
  'corrective_actions', 'resident_id',
]);

// Fields that need JSON.stringify before binding
const JSON_COLUMNS = new Set(['staff_involved', 'witnesses', 'corrective_actions']);
const TIME_COLUMNS = new Set(['time', 'cqc_notified_time', 'riddor_reported_time']);

/**
 * Update an incident. Returns shaped row on success.
 * Returns null on version conflict. Throws ConflictError if frozen.
 */
export async function update(id, homeId, data, version) {
  const fields = Object.entries(data).filter(
    ([k, v]) => v !== undefined && ALLOWED_COLUMNS.has(k)
  );
  if (fields.length === 0) return null;

  const setClause = fields.map(([k], i) => `"${k}" = $${i + 3}`).join(', ');
  const values = fields.map(([k, v]) => {
    if (JSON_COLUMNS.has(k)) return JSON.stringify(v);
    if (TIME_COLUMNS.has(k)) return normalizeTimeStr(v);
    return v;
  });
  const params = [id, homeId, ...values];
  let sql = `UPDATE incidents SET ${setClause}, version = version + 1, updated_at = NOW()
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL AND frozen_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ` RETURNING ${INCIDENT_COLS}`;
  const { rows, rowCount } = await pool.query(sql, params);
  if (rowCount === 0) {
    // Distinguish frozen from version conflict
    const frozen = await isFrozen(id, homeId);
    if (frozen) {
      const err = new Error('This incident is frozen and cannot be modified. Use addenda for post-freeze notes.');
      err.status = 403;
      throw err;
    }
    return null; // version conflict or not found
  }
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function softDelete(id, homeId) {
  const { rowCount } = await pool.query(
    `UPDATE incidents SET deleted_at = NOW()
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL AND frozen_at IS NULL`,
    [id, homeId]
  );
  return rowCount > 0;
}
