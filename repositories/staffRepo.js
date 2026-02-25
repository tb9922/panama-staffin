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
          start_date, contract_hours, al_entitlement, al_carryover, leaving_date, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
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
         contract_hours = EXCLUDED.contract_hours,
         al_entitlement = EXCLUDED.al_entitlement,
         al_carryover   = EXCLUDED.al_carryover,
         leaving_date   = EXCLUDED.leaving_date,
         updated_at     = NOW(),
         deleted_at     = NULL`,
      [
        s.id, homeId, s.name, s.role, s.team, s.pref || null,
        s.skill ?? 1, s.hourly_rate, s.active !== false, s.wtr_opt_out || false,
        s.start_date || null, s.contract_hours || null,
        s.al_entitlement || null, s.al_carryover || 0, s.leaving_date || null,
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
