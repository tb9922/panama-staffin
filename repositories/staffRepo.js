import { pool } from '../db.js';

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
    start_date: row.start_date ? row.start_date.toISOString().slice(0, 10) : null,
    date_of_birth: row.date_of_birth ? row.date_of_birth.toISOString().slice(0, 10) : null,
    ni_number: row.ni_number || null,
    contract_hours: row.contract_hours != null ? parseFloat(row.contract_hours) : null,
    al_entitlement: row.al_entitlement,
    al_carryover: row.al_carryover,
    leaving_date: row.leaving_date ? row.leaving_date.toISOString().slice(0, 10) : null,
  };
}

/**
 * Return all non-deleted staff for a home, shaped for the frontend.
 * @param {number} homeId
 */
export async function findByHome(homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM staff WHERE home_id = $1 AND deleted_at IS NULL ORDER BY name',
    [homeId]
  );
  return rows.map(shapeRow);
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

  for (const s of staffArr) {
    await conn.query(
      `INSERT INTO staff
         (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out,
          start_date, date_of_birth, ni_number, contract_hours, al_entitlement, al_carryover, leaving_date, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
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
      [
        s.id, homeId, s.name, s.role, s.team, s.pref || null,
        s.skill ?? 1, s.hourly_rate, s.active !== false, s.wtr_opt_out || false,
        s.start_date || null, s.date_of_birth || null, s.ni_number || null,
        s.contract_hours ?? null, s.al_entitlement ?? null, s.al_carryover || 0, s.leaving_date || null,
      ]
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
 * Upsert a single staff member. Used by Mode 2 staff endpoints.
 * @param {number} homeId
 * @param {object} staff — staff object with all fields including id
 */
export async function upsertOne(homeId, staff) {
  const { rows } = await pool.query(
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
     RETURNING *`,
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
 * Uses COALESCE so omitted fields keep their existing values.
 * @param {number} homeId
 * @param {string} staffId
 * @param {object} fields — partial staff object (only fields to update)
 * @returns {object|null} shaped staff row, or null if not found
 */
export async function updateOne(homeId, staffId, fields) {
  const { rows } = await pool.query(
    `UPDATE staff SET
       name           = COALESCE($3, name),
       role           = COALESCE($4, role),
       team           = COALESCE($5, team),
       pref           = CASE WHEN $6::boolean THEN $7 ELSE pref END,
       skill          = COALESCE($8, skill),
       hourly_rate    = COALESCE($9, hourly_rate),
       active         = COALESCE($10, active),
       wtr_opt_out    = COALESCE($11, wtr_opt_out),
       start_date     = CASE WHEN $12::boolean THEN $13::date ELSE start_date END,
       date_of_birth  = CASE WHEN $14::boolean THEN $15::date ELSE date_of_birth END,
       ni_number      = CASE WHEN $16::boolean THEN $17 ELSE ni_number END,
       contract_hours = CASE WHEN $18::boolean THEN $19::numeric ELSE contract_hours END,
       al_entitlement = CASE WHEN $20::boolean THEN $21::int ELSE al_entitlement END,
       al_carryover   = COALESCE($22, al_carryover),
       leaving_date   = CASE WHEN $23::boolean THEN $24::date ELSE leaving_date END,
       updated_at     = NOW()
     WHERE home_id = $1 AND id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [
      homeId,
      staffId,
      fields.name !== undefined ? fields.name : null,
      fields.role !== undefined ? fields.role : null,
      fields.team !== undefined ? fields.team : null,
      'pref' in fields,           // $6: flag — was pref provided?
      fields.pref ?? null,        // $7: value (may be null to clear)
      fields.skill !== undefined ? fields.skill : null,
      fields.hourly_rate !== undefined ? fields.hourly_rate : null,
      fields.active !== undefined ? fields.active : null,
      fields.wtr_opt_out !== undefined ? fields.wtr_opt_out : null,
      'start_date' in fields,     // $12: flag
      fields.start_date ?? null,  // $13: value
      'date_of_birth' in fields,  // $14: flag
      fields.date_of_birth ?? null, // $15: value
      'ni_number' in fields,      // $16: flag
      fields.ni_number ?? null,   // $17: value
      'contract_hours' in fields, // $18: flag
      fields.contract_hours ?? null, // $19: value
      'al_entitlement' in fields, // $20: flag
      fields.al_entitlement ?? null, // $21: value
      fields.al_carryover !== undefined ? fields.al_carryover : null,
      'leaving_date' in fields,   // $23: flag
      fields.leaving_date ?? null, // $24: value
    ]
  );
  return rows.length > 0 ? shapeRow(rows[0]) : null;
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
