import { pool } from '../db.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

const COLS = `
  id, home_id, gap_date, shift_code, role_needed, reason,
  overtime_offered, overtime_accepted, overtime_refused,
  internal_bank_checked, internal_bank_candidate_count,
  viable_internal_candidate_count, emergency_override,
  emergency_override_reason, outcome, linked_agency_shift_id,
  checked_by, checked_at, notes, version, created_at, updated_at, deleted_at
`;

const INT_FIELDS = new Set([
  'id',
  'home_id',
  'internal_bank_candidate_count',
  'viable_internal_candidate_count',
  'linked_agency_shift_id',
  'checked_by',
  'version',
]);

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function shapeRow(row) {
  if (!row) return null;
  const shaped = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'gap_date') shaped[key] = dateOnly(value);
    else if (INT_FIELDS.has(key)) shaped[key] = value == null ? null : parseInt(value, 10);
    else if (key.endsWith('_at')) shaped[key] = toIsoOrNull(value);
    else shaped[key] = value;
  }
  return shaped;
}

function inferOutcome(data) {
  if (data.outcome) return data.outcome;
  if (data.emergency_override) return 'emergency_agency';
  if (data.overtime_accepted) return 'internal_cover_found';
  if ((data.viable_internal_candidate_count || 0) > 0) return 'internal_cover_found';
  if (data.internal_bank_checked) return 'no_viable_internal';
  return 'pending';
}

export async function findById(id, homeId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM agency_approval_attempts
      WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId],
  );
  return shapeRow(rows[0]);
}

export async function findByIdForUpdate(id, homeId, client) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM agency_approval_attempts
      WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL
      FOR UPDATE`,
    [id, homeId],
  );
  return shapeRow(rows[0]);
}

export async function findByHome(homeId, filters = {}, client = pool) {
  const params = [homeId];
  const clauses = ['home_id = $1', 'deleted_at IS NULL'];
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`gap_date >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`gap_date <= $${params.length}`);
  }
  if (filters.emergency_override === true || filters.emergency_override === 'true') {
    clauses.push('emergency_override = true');
  }
  const limit = Math.min(parseInt(filters.limit ?? 100, 10) || 100, 500);
  const offset = Math.max(parseInt(filters.offset ?? 0, 10) || 0, 0);
  params.push(limit, offset);
  const limitParam = params.length - 1;
  const offsetParam = params.length;

  const { rows } = await client.query(
    `SELECT ${COLS}, COUNT(*) OVER() AS _total
       FROM agency_approval_attempts
      WHERE ${clauses.join(' AND ')}
      ORDER BY gap_date DESC, id DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params,
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return {
    rows: rows.map(({ _total, ...row }) => shapeRow(row)),
    total,
  };
}

export async function create(homeId, data, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO agency_approval_attempts (
       home_id, gap_date, shift_code, role_needed, reason,
       overtime_offered, overtime_accepted, overtime_refused,
       internal_bank_checked, internal_bank_candidate_count,
       viable_internal_candidate_count, emergency_override,
       emergency_override_reason, outcome, checked_by, notes
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
     )
     RETURNING ${COLS}`,
    [
      homeId,
      data.gap_date,
      data.shift_code,
      data.role_needed || null,
      data.reason,
      data.overtime_offered ?? false,
      data.overtime_accepted ?? false,
      data.overtime_refused ?? false,
      data.internal_bank_checked ?? false,
      data.internal_bank_candidate_count ?? 0,
      data.viable_internal_candidate_count ?? 0,
      data.emergency_override ?? false,
      data.emergency_override_reason || null,
      inferOutcome(data),
      data.checked_by || null,
      data.notes || null,
    ],
  );
  return shapeRow(rows[0]);
}

export async function update(id, homeId, data, version = null, client = pool) {
  const allowed = new Set([
    'gap_date',
    'shift_code',
    'role_needed',
    'reason',
    'overtime_offered',
    'overtime_accepted',
    'overtime_refused',
    'internal_bank_checked',
    'internal_bank_candidate_count',
    'viable_internal_candidate_count',
    'emergency_override',
    'emergency_override_reason',
    'outcome',
    'notes',
  ]);
  const shouldInferOutcome = data.outcome === undefined && (
    Object.prototype.hasOwnProperty.call(data, 'emergency_override')
    || Object.prototype.hasOwnProperty.call(data, 'overtime_accepted')
    || Object.prototype.hasOwnProperty.call(data, 'viable_internal_candidate_count')
    || Object.prototype.hasOwnProperty.call(data, 'internal_bank_checked')
  );
  const updateData = {
    ...data,
    ...(shouldInferOutcome ? { outcome: inferOutcome(data) } : {}),
  };
  const fields = Object.entries(updateData).filter(([key, value]) => (
    value !== undefined && allowed.has(key)
  ));
  if (fields.length === 0) return findById(id, homeId, client);

  const params = [id, homeId, ...fields.map(([, value]) => value)];
  const setClause = fields.map(([key], index) => `${key} = $${index + 3}`).join(', ');
  let sql = `
    UPDATE agency_approval_attempts
       SET ${setClause},
           updated_at = NOW(),
           version = version + 1
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL
  `;
  if (version != null) {
    params.push(version);
    sql += ` AND version = $${params.length}`;
  }
  sql += ` RETURNING ${COLS}`;
  const { rows, rowCount } = await client.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return shapeRow(rows[0]);
}

export async function linkAgencyShift(id, homeId, shiftId, client = pool) {
  const { rows } = await client.query(
    `UPDATE agency_approval_attempts
        SET linked_agency_shift_id = $3,
            outcome = CASE WHEN emergency_override THEN 'emergency_agency' ELSE 'agency_used' END,
            updated_at = NOW(),
            version = version + 1
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL
        AND (linked_agency_shift_id IS NULL OR linked_agency_shift_id = $3)
      RETURNING ${COLS}`,
    [id, homeId, shiftId],
  );
  return shapeRow(rows[0]);
}

export async function countEmergencyOverridesByHome(homeIds, client = pool) {
  if (!Array.isArray(homeIds) || homeIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT home_id,
            COUNT(*) FILTER (WHERE gap_date >= CURRENT_DATE - INTERVAL '7 days')::int AS attempts_7d,
            COUNT(*) FILTER (
              WHERE emergency_override = true
                AND gap_date >= CURRENT_DATE - INTERVAL '7 days'
            )::int AS emergency_overrides_7d
       FROM agency_approval_attempts
      WHERE home_id = ANY($1::int[])
        AND deleted_at IS NULL
      GROUP BY home_id`,
    [homeIds],
  );
  return rows;
}
