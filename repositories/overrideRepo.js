import { pool, toDateStr } from '../db.js';

/**
 * Return overrides for a home, shaped as:
 * { "YYYY-MM-DD": { "staffId": { shift, reason, source } } }
 *
 * Optional date-range filter prevents loading years of history on every page load.
 * Omit both to load all (backward-compatible for legacy data route).
 *
 * @param {number} homeId
 * @param {string} [fromDate]  "YYYY-MM-DD" inclusive lower bound
 * @param {string} [toDate]    "YYYY-MM-DD" inclusive upper bound
 */
export async function findByHome(homeId, fromDate, toDate, client) {
  const conn = client || pool;
  let sql = 'SELECT date, staff_id, shift, reason, source, sleep_in, replaces_staff_id, override_hours, al_hours FROM shift_overrides WHERE home_id = $1';
  const params = [homeId];
  if (fromDate) {
    params.push(fromDate);
    sql += ` AND date >= $${params.length}`;
  }
  if (toDate) {
    params.push(toDate);
    sql += ` AND date <= $${params.length}`;
  }
  const { rows } = await conn.query(sql, params);
  const result = {};
  for (const row of rows) {
    const dateStr = toDateStr(row.date);
    if (!result[dateStr]) result[dateStr] = {};
    const entry = { shift: row.shift, sleep_in: !!row.sleep_in };
    if (row.reason) entry.reason = row.reason;
    if (row.source) entry.source = row.source;
    if (row.replaces_staff_id) entry.replaces_staff_id = row.replaces_staff_id;
    if (row.override_hours != null) entry.override_hours = parseFloat(row.override_hours);
    if (row.al_hours != null) entry.al_hours = parseFloat(row.al_hours);
    result[dateStr][row.staff_id] = entry;
  }
  return result;
}

/**
 * Full replace: delete overrides for a home within a date range, then insert the incoming set.
 * Date range MUST match the window used by assembleData (6mo back, 3mo forward)
 * to avoid destroying overrides outside the loaded window.
 * Schedule data — not regulated, safe to hard-delete within transaction.
 * @param {number} homeId
 * @param {object} overridesObj { "YYYY-MM-DD": { "staffId": { shift, reason, source } } }
 * @param {object} [client]
 * @param {string} [fromDate] "YYYY-MM-DD" inclusive lower bound for delete scope
 * @param {string} [toDate]   "YYYY-MM-DD" inclusive upper bound for delete scope
 */
export async function replace(homeId, overridesObj, client, fromDate, toDate) {
  const conn = client || pool;
  if (fromDate && toDate) {
    await conn.query('DELETE FROM shift_overrides WHERE home_id = $1 AND date >= $2 AND date <= $3', [homeId, fromDate, toDate]);
  } else {
    await conn.query('DELETE FROM shift_overrides WHERE home_id = $1', [homeId]);
  }

  if (!overridesObj || Object.keys(overridesObj).length === 0) return;

  // Flatten to rows
  const rows = [];
  for (const [date, dayOverrides] of Object.entries(overridesObj)) {
    for (const [staffId, override] of Object.entries(dayOverrides)) {
      rows.push([homeId, date, staffId, override.shift, override.reason || null, override.source || null, override.sleep_in ?? false, override.replaces_staff_id ?? null, override.override_hours ?? null, override.al_hours ?? null]);
    }
  }

  if (rows.length === 0) return;

  // Batch insert in chunks of 500 to avoid max parameter limits
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = chunk.map((_, idx) => {
      const base = idx * 10;
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10})`;
    }).join(', ');
    const params = chunk.flat();
    await conn.query(
      `INSERT INTO shift_overrides (home_id, date, staff_id, shift, reason, source, sleep_in, replaces_staff_id, override_hours, al_hours)
       VALUES ${values}`,
      params
    );
  }
}

/**
 * Delete all overrides for a specific staff member.
 * Called when a staff member is removed from the register.
 * @param {number} homeId
 * @param {string} staffId
 * @param {object} [client]
 */
export async function deleteForStaff(homeId, staffId, client) {
  const conn = client || pool;
  await conn.query(
    'DELETE FROM shift_overrides WHERE home_id = $1 AND staff_id = $2',
    [homeId, staffId]
  );
}

/**
 * Upsert a single override row.
 * @param {number} homeId
 * @param {string} date  "YYYY-MM-DD"
 * @param {string} staffId
 * @param {{ shift, reason, source, sleep_in, replaces_staff_id }} override
 */
export async function upsertOne(homeId, date, staffId, { shift, reason, source, sleep_in, replaces_staff_id, override_hours, al_hours }, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO shift_overrides (home_id, date, staff_id, shift, reason, source, sleep_in, replaces_staff_id, override_hours, al_hours, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (home_id, date, staff_id)
     DO UPDATE SET shift=EXCLUDED.shift, reason=EXCLUDED.reason,
                   source=EXCLUDED.source, sleep_in=EXCLUDED.sleep_in,
                   replaces_staff_id=EXCLUDED.replaces_staff_id,
                   override_hours=EXCLUDED.override_hours,
                   al_hours=EXCLUDED.al_hours, updated_at=NOW()
     RETURNING home_id`,
    [homeId, date, staffId, shift, reason ?? null, source ?? 'manual', sleep_in ?? false, replaces_staff_id ?? null, override_hours ?? null, al_hours ?? null]
  );
  return rows[0];
}

/**
 * Delete a single override row.
 * @param {number} homeId
 * @param {string} date  "YYYY-MM-DD"
 * @param {string} staffId
 * @returns {boolean} true if a row was deleted
 */
export async function deleteOne(homeId, date, staffId) {
  const { rowCount } = await pool.query(
    `DELETE FROM shift_overrides WHERE home_id=$1 AND date=$2 AND staff_id=$3`,
    [homeId, date, staffId]
  );
  return rowCount > 0;
}

/**
 * Upsert multiple override rows in chunks of 100.
 * homeId is always $1; per-row params are date, staffId, shift, reason, source, sleep_in, replaces_staff_id.
 * @param {number} homeId
 * @param {Array<{ date, staffId, shift, reason, source, sleep_in, replaces_staff_id }>} rows
 * @param {object} [client]
 */
export async function upsertBulk(homeId, rows, client) {
  if (!rows || rows.length === 0) return;
  const db = client || pool;
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    chunk.forEach(({ date, staffId, shift, reason, source, sleep_in, replaces_staff_id, override_hours, al_hours }, j) => {
      const base = j * 9;
      params.push(
        `($1,$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},NOW())`
      );
      values.push(date, staffId, shift, reason ?? null, source ?? 'manual', sleep_in ?? false, replaces_staff_id ?? null, override_hours ?? null, al_hours ?? null);
    });
    await db.query(
      `INSERT INTO shift_overrides (home_id, date, staff_id, shift, reason, source, sleep_in, replaces_staff_id, override_hours, al_hours, updated_at)
       VALUES ${params.join(',')}
       ON CONFLICT (home_id, date, staff_id)
       DO UPDATE SET shift=EXCLUDED.shift, reason=EXCLUDED.reason,
                     source=EXCLUDED.source, sleep_in=EXCLUDED.sleep_in,
                     replaces_staff_id=EXCLUDED.replaces_staff_id,
                     override_hours=EXCLUDED.override_hours,
                     al_hours=EXCLUDED.al_hours, updated_at=NOW()`,
      [homeId, ...values]
    );
  }
}

/**
 * Delete all overrides within a date range (inclusive).
 * Used for month-revert operations.
 * @param {number} homeId
 * @param {string} fromDate  "YYYY-MM-DD"
 * @param {string} toDate    "YYYY-MM-DD"
 * @returns {number} rows deleted
 */
export async function deleteForDateRange(homeId, fromDate, toDate) {
  const { rowCount } = await pool.query(
    `DELETE FROM shift_overrides WHERE home_id=$1 AND date >= $2 AND date <= $3`,
    [homeId, fromDate, toDate]
  );
  return rowCount;
}
