import { pool } from '../db.js';

function shapeRow(row) {
  return {
    id:                      row.id,
    date:                    row.date ? row.date.toISOString().slice(0, 10) : null,
    time:                    row.time || undefined,
    scenario:                row.scenario || undefined,
    evacuation_time_seconds: row.evacuation_time_seconds || undefined,
    staff_present:           row.staff_present || [],
    residents_evacuated:     row.residents_evacuated || undefined,
    issues:                  row.issues || undefined,
    corrective_actions:      row.corrective_actions || undefined,
    conducted_by:            row.conducted_by || undefined,
    notes:                   row.notes || undefined,
  };
}

/**
 * Return all fire drill records for a home.
 * @param {number} homeId
 */
export async function findByHome(homeId) {
  const { rows } = await pool.query(
    `SELECT * FROM fire_drills WHERE home_id = $1 ORDER BY date DESC`,
    [homeId]
  );
  return rows.map(shapeRow);
}

/**
 * Sync fire drill records. Upserts incoming, hard-deletes removed drills.
 * @param {number} homeId
 * @param {Array} drillsArr
 * @param {object} [client]
 */
export async function sync(homeId, drillsArr, client) {
  const conn = client || pool;
  if (!drillsArr) return;

  const incomingIds = drillsArr.map(d => d.id);

  for (const d of drillsArr) {
    await conn.query(
      `INSERT INTO fire_drills
         (id, home_id, date, time, scenario, evacuation_time_seconds, staff_present,
          residents_evacuated, issues, corrective_actions, conducted_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (home_id, id) DO UPDATE SET
         date                    = EXCLUDED.date,
         time                    = EXCLUDED.time,
         scenario                = EXCLUDED.scenario,
         evacuation_time_seconds = EXCLUDED.evacuation_time_seconds,
         staff_present           = EXCLUDED.staff_present,
         residents_evacuated     = EXCLUDED.residents_evacuated,
         issues                  = EXCLUDED.issues,
         corrective_actions      = EXCLUDED.corrective_actions,
         conducted_by            = EXCLUDED.conducted_by,
         notes                   = EXCLUDED.notes`,
      [
        d.id, homeId, d.date, d.time || null, d.scenario || null,
        d.evacuation_time_seconds || null,
        JSON.stringify(d.staff_present || []),
        d.residents_evacuated || null, d.issues || null,
        d.corrective_actions || null, d.conducted_by || null, d.notes || null,
      ]
    );
  }

  if (incomingIds.length > 0) {
    await conn.query(
      `DELETE FROM fire_drills WHERE home_id = $1 AND id != ALL($2::text[])`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query('DELETE FROM fire_drills WHERE home_id = $1', [homeId]);
  }
}
