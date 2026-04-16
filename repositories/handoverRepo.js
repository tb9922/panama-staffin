import { pool } from '../db.js';

const COLS = 'id, home_id, entry_date, shift, category, priority, content, incident_id, author, version, created_at, updated_at, acknowledged_by, acknowledged_at';

function shapeRow(row) {
  return {
    id: row.id,
    entry_date: row.entry_date instanceof Date
      ? row.entry_date.toISOString().slice(0, 10)
      : String(row.entry_date).slice(0, 10),
    shift: row.shift,
    category: row.category,
    priority: row.priority,
    content: row.content,
    incident_id: row.incident_id || null,
    author: row.author,
    version: row.version != null ? parseInt(row.version, 10) : 1,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    acknowledged_by: row.acknowledged_by || null,
    acknowledged_at: row.acknowledged_at instanceof Date ? row.acknowledged_at.toISOString() : (row.acknowledged_at || null),
  };
}

export async function findById(id, homeId) {
  const { rows } = await pool.query(
    `SELECT ${COLS}
     FROM handover_entries
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

/**
 * Return all handover entries for a home on a given date, ordered by shift then category.
 * @param {number} homeId
 * @param {string} date  "YYYY-MM-DD"
 */
export async function findByHomeAndDate(homeId, date, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT ${COLS}, COUNT(*) OVER() AS _total FROM handover_entries
     WHERE home_id = $1 AND entry_date = $2 AND deleted_at IS NULL
     ORDER BY
       CASE shift WHEN 'E' THEN 1 WHEN 'L' THEN 2 WHEN 'N' THEN 3 ELSE 4 END,
       CASE category WHEN 'clinical' THEN 1 WHEN 'safety' THEN 2 WHEN 'operational' THEN 3 WHEN 'admin' THEN 4 ELSE 5 END,
       created_at
     LIMIT $3 OFFSET $4`,
    [homeId, date, Math.min(limit, 500), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeRow(rest); }), total };
}

/**
 * Return all handover entries for a home across a date range (for export).
 * @param {number} homeId
 * @param {string} fromDate  "YYYY-MM-DD"
 * @param {string} toDate    "YYYY-MM-DD"
 */
export async function findByHomeAndDateRange(homeId, fromDate, toDate, { limit = 500, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT ${COLS}, COUNT(*) OVER() AS _total FROM handover_entries
     WHERE home_id = $1 AND entry_date BETWEEN $2 AND $3 AND deleted_at IS NULL
     ORDER BY entry_date,
       CASE shift WHEN 'E' THEN 1 WHEN 'L' THEN 2 WHEN 'N' THEN 3 ELSE 4 END,
       created_at
     LIMIT $4 OFFSET $5`,
    [homeId, fromDate, toDate, Math.min(limit, 2000), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeRow(rest); }), total };
}

/**
 * Insert a new handover entry. Returns the created row.
 * @param {number} homeId
 * @param {{ entry_date, shift, category, priority, content, incident_id }} entry
 * @param {string} author  from req.user.username (set server-side)
 */
export async function createEntry(homeId, entry, author, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO handover_entries (home_id, entry_date, shift, category, priority, content, incident_id, author)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLS}`,
    [homeId, entry.entry_date, entry.shift, entry.category, entry.priority, entry.content, entry.incident_id || null, author]
  );
  return shapeRow(rows[0]);
}

/**
 * Update the content and priority of an entry. Returns the updated row.
 * Only content and priority are mutable (structural fields are immutable after creation).
 * @param {string} id      UUID
 * @param {number} homeId  ownership check
 * @param {{ content, priority }} updates
 */
export async function updateEntry(id, homeId, updates, version) {
  const params = [id, homeId, updates.content, updates.priority];
  let sql = `UPDATE handover_entries
     SET content = $3, priority = $4, updated_at = NOW(), version = version + 1
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) {
    params.push(version);
    sql += ` AND version = $${params.length}`;
  }
  sql += ` RETURNING ${COLS}`;
  const { rows } = await pool.query(
    sql,
    params
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

/**
 * Mark an entry as acknowledged by a user.
 * @param {string} id       UUID
 * @param {number} homeId   ownership check
 * @param {string} username from req.user.username (set server-side)
 */
export async function acknowledgeEntry(id, homeId, username) {
  const { rows } = await pool.query(
    `UPDATE handover_entries
     SET acknowledged_by = $3, acknowledged_at = NOW()
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL
     RETURNING ${COLS}`,
    [id, homeId, username]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

/**
 * Soft-delete an entry by setting deleted_at.
 * @param {string} id      UUID
 * @param {number} homeId  ownership check
 */
export async function deleteEntry(id, homeId, version) {
  const params = [id, homeId];
  let sql = 'UPDATE handover_entries SET deleted_at = NOW(), updated_at = NOW(), version = version + 1 WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL';
  if (version != null) {
    params.push(version);
    sql += ` AND version = $${params.length}`;
  }
  const { rowCount } = await pool.query(
    sql,
    params
  );
  return rowCount > 0;
}
