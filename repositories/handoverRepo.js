import { pool } from '../db.js';

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
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

/**
 * Return all handover entries for a home on a given date, ordered by shift then category.
 * @param {number} homeId
 * @param {string} date  "YYYY-MM-DD"
 */
export async function findByHomeAndDate(homeId, date) {
  const { rows } = await pool.query(
    `SELECT * FROM handover_entries
     WHERE home_id = $1 AND entry_date = $2
     ORDER BY
       CASE shift WHEN 'E' THEN 1 WHEN 'L' THEN 2 WHEN 'N' THEN 3 ELSE 4 END,
       CASE category WHEN 'clinical' THEN 1 WHEN 'safety' THEN 2 WHEN 'operational' THEN 3 WHEN 'admin' THEN 4 ELSE 5 END,
       created_at`,
    [homeId, date]
  );
  return rows.map(shapeRow);
}

/**
 * Return all handover entries for a home across a date range (for export).
 * @param {number} homeId
 * @param {string} fromDate  "YYYY-MM-DD"
 * @param {string} toDate    "YYYY-MM-DD"
 */
export async function findByHomeAndDateRange(homeId, fromDate, toDate) {
  const { rows } = await pool.query(
    `SELECT * FROM handover_entries
     WHERE home_id = $1 AND entry_date BETWEEN $2 AND $3
     ORDER BY entry_date,
       CASE shift WHEN 'E' THEN 1 WHEN 'L' THEN 2 WHEN 'N' THEN 3 ELSE 4 END,
       created_at`,
    [homeId, fromDate, toDate]
  );
  return rows.map(shapeRow);
}

/**
 * Insert a new handover entry. Returns the created row.
 * @param {number} homeId
 * @param {{ entry_date, shift, category, priority, content, incident_id }} entry
 * @param {string} author  from req.user.username (set server-side)
 */
export async function createEntry(homeId, entry, author) {
  const { rows } = await pool.query(
    `INSERT INTO handover_entries (home_id, entry_date, shift, category, priority, content, incident_id, author)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
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
export async function updateEntry(id, homeId, updates) {
  const { rows } = await pool.query(
    `UPDATE handover_entries
     SET content = $3, priority = $4, updated_at = NOW()
     WHERE id = $1 AND home_id = $2
     RETURNING *`,
    [id, homeId, updates.content, updates.priority]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

/**
 * Delete an entry. Returns true if deleted, false if not found.
 * @param {string} id      UUID
 * @param {number} homeId  ownership check
 */
export async function deleteEntry(id, homeId) {
  const { rowCount } = await pool.query(
    'DELETE FROM handover_entries WHERE id = $1 AND home_id = $2',
    [id, homeId]
  );
  return rowCount > 0;
}
