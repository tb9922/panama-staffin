import { pool, toDateStr } from '../db.js';

/* Explicit column list — no SELECT * — so future columns don't auto-leak to API consumers. */
const STAFF_COLS = `id, home_id, name, role, team, pref, skill, hourly_rate,
  active, wtr_opt_out, start_date, contract_hours,
  date_of_birth, ni_number, al_entitlement, al_carryover,
  leaving_date, version, created_at, updated_at, deleted_at`;

function shapeRow(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    team: row.team,
    pref: row.pref,
    skill: parseFloat(row.skill),
    hourly_rate: parseFloat(row.hourly_rate),
    active: row.active,
    wtr_opt_out: row.wtr_opt_out,
    start_date: toDateStr(row.start_date),
    date_of_birth: toDateStr(row.date_of_birth),
    ni_number: row.ni_number || null,
    contract_hours: row.contract_hours != null ? parseFloat(row.contract_hours) : null,
    al_entitlement: row.al_entitlement != null ? parseFloat(row.al_entitlement) : null,
    al_carryover: row.al_carryover != null ? parseFloat(row.al_carryover) : 0,
    leaving_date: toDateStr(row.leaving_date),
    version: row.version != null ? parseInt(row.version, 10) : undefined,
  };
}

/**
 * Generate the next staff ID for a home (e.g. "S001", "S002").
 * Uses FOR UPDATE to prevent concurrent ID collisions.
 * @param {number} homeId
 * @param {object} client - transaction client (required for FOR UPDATE safety)
 * @returns {Promise<string>}
 */
export async function nextId(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT id FROM staff WHERE home_id = $1 ORDER BY id FOR UPDATE`,
    [homeId]
  );
  let maxNum = 0;
  for (const r of rows) {
    const num = parseInt(r.id.replace(/^S/i, ''), 10);
    if (!isNaN(num) && num > maxNum) maxNum = num;
  }
  return 'S' + String(maxNum + 1).padStart(3, '0');
}

/**
 * Return all non-deleted staff for a home, shaped for the frontend.
 * @param {number} homeId
 */
export async function findByHome(homeId, { limit = 1000, offset = 0 } = {}, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${STAFF_COLS}, COUNT(*) OVER() AS _total FROM staff
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY name LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 1000), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeRow(rest); }), total };
}

/**
 * Sync incoming staff array to DB.
 * Upserts all incoming records. Soft-deletes any DB records not in the incoming list.
 * @param {number} homeId
 * @param {Array} staffArr
 * @param {object} [client]
 */
export async function sync(homeId, staffArr, client) {
  const conn = client || pool;
  if (!staffArr || staffArr.length === 0) return;

  const incomingIds = staffArr.map(s => s.id);

  // Batch upsert — 16 per-row params, homeId shared as $1
  const COLS_PER_ROW = 16;
  const CHUNK = 50; // 50 × 16 = 800 params + 1 homeId = well within PG 65535 limit
  for (let i = 0; i < staffArr.length; i += CHUNK) {
    const chunk = staffArr.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((s, j) => {
      const base = j * COLS_PER_ROW + 2; // $1 is homeId
      placeholders.push(
        `($${base},$1,$${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},$${base+14},$${base+15},NOW())`
      );
      values.push(
        s.id, s.name, s.role, s.team, s.pref || null,
        s.skill ?? 1, s.hourly_rate, s.active !== false, s.wtr_opt_out ?? false,
        s.start_date || null, s.date_of_birth || null, s.ni_number || null,
        s.contract_hours ?? null, s.al_entitlement ?? null, s.al_carryover ?? 0, s.leaving_date || null,
      );
    });
    await conn.query(
      `INSERT INTO staff
         (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out,
          start_date, date_of_birth, ni_number, contract_hours, al_entitlement, al_carryover, leaving_date, updated_at)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, id) DO UPDATE SET
         name           = EXCLUDED.name,
         role           = EXCLUDED.role,
         team           = EXCLUDED.team,
         pref           = EXCLUDED.pref,
         skill          = EXCLUDED.skill,
         hourly_rate    = EXCLUDED.hourly_rate,
         active         = EXCLUDED.active,
         wtr_opt_out    = EXCLUDED.wtr_opt_out,
         start_date     = EXCLUDED.start_date,
         date_of_birth  = EXCLUDED.date_of_birth,
         ni_number      = EXCLUDED.ni_number,
         contract_hours = EXCLUDED.contract_hours,
         al_entitlement = EXCLUDED.al_entitlement,
         al_carryover   = EXCLUDED.al_carryover,
         leaving_date   = EXCLUDED.leaving_date,
         updated_at     = NOW(),
         deleted_at     = NULL`,
      [homeId, ...values]
    );
  }

  // Soft-delete records removed from the frontend
  await conn.query(
    `UPDATE staff SET deleted_at = NOW()
     WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
    [homeId, incomingIds]
  );
}

/**
 * Find a single staff member by ID. Returns shaped row or null.
 * @param {number} homeId
 * @param {string} staffId
 */
export async function findById(homeId, staffId) {
  const { rows } = await pool.query(
    `SELECT ${STAFF_COLS} FROM staff WHERE home_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [homeId, staffId]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

/**
 * Upsert a single staff member. Used by Mode 2 staff endpoints.
 * @param {number} homeId
 * @param {object} staff — staff object with all fields including id
 */
export async function upsertOne(homeId, staff, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO staff
       (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out,
        start_date, leaving_date, date_of_birth, ni_number, contract_hours,
        al_entitlement, al_carryover, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
     ON CONFLICT (home_id, id) DO UPDATE SET
       name=$3, role=$4, team=$5, pref=$6, skill=$7, hourly_rate=$8,
       active=$9, wtr_opt_out=$10, start_date=$11, leaving_date=$12,
       date_of_birth=$13, ni_number=$14, contract_hours=$15,
       al_entitlement=$16, al_carryover=$17, updated_at=NOW(),
       deleted_at=NULL
     RETURNING ${STAFF_COLS}`,
    [
      staff.id, homeId, staff.name, staff.role || null, staff.team || null,
      staff.pref || null,
      staff.skill != null ? staff.skill : null,
      staff.hourly_rate != null ? staff.hourly_rate : null,
      staff.active !== false,
      staff.wtr_opt_out === true,
      staff.start_date || null, staff.leaving_date || null,
      staff.date_of_birth || null, staff.ni_number || null,
      staff.contract_hours != null ? staff.contract_hours : null,
      staff.al_entitlement != null ? staff.al_entitlement : null,
      staff.al_carryover != null ? staff.al_carryover : 0,
    ]
  );
  return shapeRow(rows[0]);
}

/**
 * Update a single staff member by ID. Only updates fields present in `fields`.
 * Dynamic SET pattern — allows clearing fields to NULL (fixes COALESCE bug).
 * @param {number} homeId
 * @param {string} staffId
 * @param {object} fields — partial staff object (only fields to update)
 * @param {number} [version] — optimistic lock version (optional)
 * @returns {object|null} shaped staff row, or null if not found / version conflict
 */
export async function updateOne(homeId, staffId, fields, version) {
  const setClauses = [];
  const params = [homeId, staffId];
  const settable = {
    name: 'name', role: 'role', team: 'team', pref: 'pref',
    skill: 'skill', hourly_rate: 'hourly_rate', active: 'active',
    wtr_opt_out: 'wtr_opt_out', start_date: 'start_date::date',
    date_of_birth: 'date_of_birth::date', ni_number: 'ni_number',
    contract_hours: 'contract_hours::numeric', al_entitlement: 'al_entitlement::numeric',
    al_carryover: 'al_carryover', leaving_date: 'leaving_date::date',
  };
  for (const [key, cast] of Object.entries(settable)) {
    if (key in fields) {
      params.push(fields[key] ?? null);
      const col = cast.includes('::') ? cast.split('::')[0] : cast;
      const typeCast = cast.includes('::') ? '::' + cast.split('::')[1] : '';
      setClauses.push(`${col} = $${params.length}${typeCast}`);
    }
  }
  if (setClauses.length === 0) {
    const { rows } = await pool.query(
      `SELECT ${STAFF_COLS} FROM staff WHERE home_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [homeId, staffId]
    );
    return rows[0] ? shapeRow(rows[0]) : null;
  }
  setClauses.push('updated_at = NOW()');
  setClauses.push('version = version + 1');
  let sql = `UPDATE staff SET ${setClauses.join(', ')} WHERE home_id = $1 AND id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ` RETURNING ${STAFF_COLS}`;
  const { rows, rowCount } = await pool.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeRow(rows[0]) : null;
}

/**
 * Soft-delete a single staff member.
 * @param {number} homeId
 * @param {string} staffId
 * @param {object} [client] — optional pg client for transaction participation
 */
export async function softDeleteOne(homeId, staffId, client) {
  const { rowCount } = await (client || pool).query(
    `UPDATE staff SET deleted_at = NOW(), active = false, leaving_date = CURRENT_DATE
     WHERE home_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [homeId, staffId]
  );
  return rowCount > 0;
}
