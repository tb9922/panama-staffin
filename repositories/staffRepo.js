import { ConflictError } from '../errors.js';
import { pool, toDateStr } from '../db.js';

/* Explicit column list — no SELECT * — so future columns don't auto-leak to API consumers. */
const STAFF_COLS = `id, home_id, name, role, team, pref, skill, hourly_rate,
  active, wtr_opt_out, start_date, contract_hours,
  date_of_birth, ni_number, al_entitlement, al_carryover,
  leaving_date, phone, address, emergency_contact,
  willing_extras, willing_other_homes, max_weekly_hours_topup,
  max_travel_radius_km, home_postcode, internal_bank_status, internal_bank_notes,
  version, created_at, updated_at, deleted_at`;

function shapeRow(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    team: row.team,
    pref: row.pref,
    skill: row.skill != null ? parseFloat(row.skill) : null,
    hourly_rate: row.hourly_rate != null ? parseFloat(row.hourly_rate) : null,
    active: row.active,
    wtr_opt_out: row.wtr_opt_out,
    start_date: toDateStr(row.start_date),
    date_of_birth: toDateStr(row.date_of_birth),
    ni_number: row.ni_number || null,
    contract_hours: row.contract_hours != null ? parseFloat(row.contract_hours) : null,
    al_entitlement: row.al_entitlement != null ? parseFloat(row.al_entitlement) : null,
    al_carryover: row.al_carryover != null ? parseFloat(row.al_carryover) : 0,
    leaving_date: toDateStr(row.leaving_date),
    phone: row.phone || null,
    address: row.address || null,
    emergency_contact: row.emergency_contact || null,
    willing_extras: row.willing_extras === true,
    willing_other_homes: row.willing_other_homes === true,
    max_weekly_hours_topup: row.max_weekly_hours_topup != null ? parseFloat(row.max_weekly_hours_topup) : null,
    max_travel_radius_km: row.max_travel_radius_km != null ? parseInt(row.max_travel_radius_km, 10) : null,
    home_postcode: row.home_postcode || null,
    internal_bank_status: row.internal_bank_status || 'available',
    internal_bank_notes: row.internal_bank_notes || null,
    version: row.version != null ? parseInt(row.version, 10) : undefined,
  };
}

function parseSequentialStaffId(id) {
  if (typeof id !== 'string') return null;
  const match = /^S(\d+)$/i.exec(id.trim());
  return match ? parseInt(match[1], 10) : null;
}

async function ensureStaffIdCounterAtLeast(homeId, nextValue, client) {
  if (!Number.isInteger(nextValue) || nextValue < 1) return;
  const conn = client || pool;
  await conn.query(
    `INSERT INTO staff_id_counters (home_id, next_value)
     VALUES ($1, $2)
     ON CONFLICT (home_id) DO UPDATE
     SET next_value = GREATEST(staff_id_counters.next_value, EXCLUDED.next_value),
         updated_at = NOW()`,
    [homeId, nextValue]
  );
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
    `WITH current_max AS (
       SELECT COALESCE(MAX(substring(id FROM 2)::int), 0) AS max_num
       FROM staff
       WHERE home_id = $1 AND id ~ '^S[0-9]+$'
     ),
     seed AS (
       INSERT INTO staff_id_counters (home_id, next_value)
       SELECT $1, max_num + 1
       FROM current_max
       ON CONFLICT (home_id) DO NOTHING
     ),
     bump AS (
       UPDATE staff_id_counters counter
       SET next_value = GREATEST(counter.next_value, current_max.max_num + 1) + 1,
           updated_at = NOW()
       FROM current_max
       WHERE counter.home_id = $1
       RETURNING counter.next_value - 1 AS allocated
     )
     SELECT allocated FROM bump`,
    [homeId]
  );
  return 'S' + String(rows[0].allocated).padStart(3, '0');
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
  const highestIncomingId = staffArr.reduce((max, staff) => {
    const parsed = parseSequentialStaffId(staff.id);
    return parsed != null && parsed > max ? parsed : max;
  }, 0);

  const incomingIds = staffArr.map(s => s.id);

  // Batch upsert - 26 per-row params, homeId shared as $1
  const COLS_PER_ROW = 26;
  const CHUNK = 50; // keep well within PG parameter limits
  for (let i = 0; i < staffArr.length; i += CHUNK) {
    const chunk = staffArr.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((s, j) => {
      const base = j * COLS_PER_ROW + 2; // $1 is homeId
      placeholders.push(
        `($${base},$1,$${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},$${base+14},$${base+15},$${base+16},$${base+17},$${base+18},$${base+19},$${base+20},$${base+21},$${base+22},$${base+23},$${base+24},$${base+25},NOW())`
      );
      values.push(
        s.id, s.name, s.role, s.team, s.pref || null,
        s.skill ?? 1, s.hourly_rate, s.active !== false, s.wtr_opt_out ?? false,
        s.start_date || null, s.date_of_birth || null, s.ni_number || null,
        s.contract_hours ?? null, s.al_entitlement ?? null, s.al_carryover ?? 0, s.leaving_date || null,
        s.phone || null, s.address || null, s.emergency_contact || null,
        s.willing_extras ?? false, s.willing_other_homes ?? false,
        s.max_weekly_hours_topup ?? null, s.max_travel_radius_km ?? null,
        s.home_postcode || null, s.internal_bank_status || 'available',
        s.internal_bank_notes || null,
      );
    });
    await conn.query(
      `INSERT INTO staff
         (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out,
          start_date, date_of_birth, ni_number, contract_hours, al_entitlement, al_carryover, leaving_date,
          phone, address, emergency_contact,
          willing_extras, willing_other_homes, max_weekly_hours_topup,
          max_travel_radius_km, home_postcode, internal_bank_status, internal_bank_notes,
          updated_at)
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
         phone          = EXCLUDED.phone,
         address        = EXCLUDED.address,
         emergency_contact = EXCLUDED.emergency_contact,
         willing_extras = EXCLUDED.willing_extras,
         willing_other_homes = EXCLUDED.willing_other_homes,
         max_weekly_hours_topup = EXCLUDED.max_weekly_hours_topup,
         max_travel_radius_km = EXCLUDED.max_travel_radius_km,
         home_postcode = EXCLUDED.home_postcode,
         internal_bank_status = EXCLUDED.internal_bank_status,
         internal_bank_notes = EXCLUDED.internal_bank_notes,
         updated_at     = NOW(),
         version        = staff.version + 1,
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
  await ensureStaffIdCounterAtLeast(homeId, highestIncomingId + 1, conn);
}

/**
 * Find a single staff member by ID. Returns shaped row or null.
 * @param {number} homeId
 * @param {string} staffId
 */
export async function findById(homeId, staffId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
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
        al_entitlement, al_carryover, phone, address, emergency_contact,
        willing_extras, willing_other_homes, max_weekly_hours_topup,
        max_travel_radius_km, home_postcode, internal_bank_status, internal_bank_notes,
        updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW())
     ON CONFLICT (home_id, id) DO UPDATE SET
       name=$3, role=$4, team=$5, pref=$6, skill=$7, hourly_rate=$8,
       active=$9, wtr_opt_out=$10, start_date=$11, leaving_date=$12,
       date_of_birth=$13, ni_number=$14, contract_hours=$15,
       al_entitlement=$16, al_carryover=$17, phone=$18, address=$19,
       emergency_contact=$20, willing_extras=$21, willing_other_homes=$22,
       max_weekly_hours_topup=$23, max_travel_radius_km=$24, home_postcode=$25,
       internal_bank_status=$26, internal_bank_notes=$27, updated_at=NOW(),
       version = staff.version + 1,
       deleted_at=NULL
     RETURNING ${STAFF_COLS}`,
    [
      staff.id, homeId, staff.name, staff.role || null, staff.team || null,
      staff.pref || null,
      staff.skill ?? 1,
      staff.hourly_rate != null ? staff.hourly_rate : null,
      staff.active !== false,
      staff.wtr_opt_out === true,
      staff.start_date || null, staff.leaving_date || null,
      staff.date_of_birth || null, staff.ni_number || null,
      staff.contract_hours != null ? staff.contract_hours : null,
      staff.al_entitlement != null ? staff.al_entitlement : null,
      staff.al_carryover != null ? staff.al_carryover : 0,
      staff.phone || null,
      staff.address || null,
      staff.emergency_contact || null,
      staff.willing_extras === true,
      staff.willing_other_homes === true,
      staff.max_weekly_hours_topup != null ? staff.max_weekly_hours_topup : null,
      staff.max_travel_radius_km != null ? staff.max_travel_radius_km : null,
      staff.home_postcode || null,
      staff.internal_bank_status || 'available',
      staff.internal_bank_notes || null,
    ]
  );
  await ensureStaffIdCounterAtLeast(homeId, (parseSequentialStaffId(staff.id) || 0) + 1, conn);
  return shapeRow(rows[0]);
}

export async function createOne(homeId, staff, client) {
  const conn = client || pool;
  try {
    const { rows } = await conn.query(
      `INSERT INTO staff
         (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out,
          start_date, leaving_date, date_of_birth, ni_number, contract_hours,
          al_entitlement, al_carryover, phone, address, emergency_contact,
          willing_extras, willing_other_homes, max_weekly_hours_topup,
          max_travel_radius_km, home_postcode, internal_bank_status, internal_bank_notes,
          updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW())
       RETURNING ${STAFF_COLS}`,
      [
        staff.id, homeId, staff.name, staff.role || null, staff.team || null,
        staff.pref || null,
        staff.skill ?? 1,
        staff.hourly_rate != null ? staff.hourly_rate : null,
        staff.active !== false,
        staff.wtr_opt_out === true,
        staff.start_date || null, staff.leaving_date || null,
        staff.date_of_birth || null, staff.ni_number || null,
        staff.contract_hours != null ? staff.contract_hours : null,
        staff.al_entitlement != null ? staff.al_entitlement : null,
        staff.al_carryover != null ? staff.al_carryover : 0,
        staff.phone || null,
        staff.address || null,
        staff.emergency_contact || null,
        staff.willing_extras === true,
        staff.willing_other_homes === true,
        staff.max_weekly_hours_topup != null ? staff.max_weekly_hours_topup : null,
        staff.max_travel_radius_km != null ? staff.max_travel_radius_km : null,
        staff.home_postcode || null,
        staff.internal_bank_status || 'available',
        staff.internal_bank_notes || null,
      ]
    );
    await ensureStaffIdCounterAtLeast(homeId, (parseSequentialStaffId(staff.id) || 0) + 1, conn);
    return shapeRow(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      throw new ConflictError('Staff member ID already exists in this home');
    }
    throw err;
  }
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
export async function updateOne(homeId, staffId, fields, version, client) {
  const effectiveFields = { ...fields };
  if (effectiveFields.active === false && !('leaving_date' in effectiveFields)) {
    effectiveFields.leaving_date = new Date().toISOString().slice(0, 10);
  }
  const setClauses = [];
  const params = [homeId, staffId];
  const settable = {
    name: 'name', role: 'role', team: 'team', pref: 'pref',
    skill: 'skill', hourly_rate: 'hourly_rate', active: 'active',
    wtr_opt_out: 'wtr_opt_out', start_date: 'start_date::date',
    date_of_birth: 'date_of_birth::date', ni_number: 'ni_number',
    contract_hours: 'contract_hours::numeric', al_entitlement: 'al_entitlement::numeric',
    al_carryover: 'al_carryover', leaving_date: 'leaving_date::date',
    phone: 'phone', address: 'address', emergency_contact: 'emergency_contact',
    willing_extras: 'willing_extras',
    willing_other_homes: 'willing_other_homes',
    max_weekly_hours_topup: 'max_weekly_hours_topup::numeric',
    max_travel_radius_km: 'max_travel_radius_km::int',
    home_postcode: 'home_postcode',
    internal_bank_status: 'internal_bank_status',
    internal_bank_notes: 'internal_bank_notes',
  };
  for (const [key, cast] of Object.entries(settable)) {
    if (key in effectiveFields) {
      params.push(effectiveFields[key] ?? null);
      const col = cast.includes('::') ? cast.split('::')[0] : cast;
      const typeCast = cast.includes('::') ? '::' + cast.split('::')[1] : '';
      setClauses.push(`${col} = $${params.length}${typeCast}`);
    }
  }
  const conn = client || pool;
  if (setClauses.length === 0) {
    const { rows } = await conn.query(
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
  const { rows, rowCount } = await conn.query(sql, params);
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
    `UPDATE staff SET deleted_at = NOW(), active = false, leaving_date = CURRENT_DATE, updated_at = NOW()
     WHERE home_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [homeId, staffId]
  );
  return rowCount > 0;
}
