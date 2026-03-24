import { pool } from '../db.js';

export async function log(action, homeSlug, username, details, client) {
  const conn = client || pool;
  const detailsValue = details != null ? JSON.stringify(details) : null;
  await conn.query(
    `INSERT INTO audit_log (action, home_slug, user_name, details) VALUES ($1,$2,$3,$4)`,
    [action, homeSlug || null, username || null, detailsValue]
  );
}

export async function getRecent(limit = 100) {
  const { rows } = await pool.query(
    `SELECT id, ts, action, home_slug, user_name, details
       FROM audit_log
      ORDER BY ts DESC
      LIMIT $1`,
    [limit]
  );
  return rows.map(r => ({
    ...r,
    ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts,
  }));
}

export async function countOlderThan(days, homeSlug) {
  const { rows } = homeSlug
    ? await pool.query(
        `SELECT COUNT(*)::int AS count FROM audit_log WHERE ts < NOW() - INTERVAL '1 day' * $1 AND home_slug = $2`,
        [days, homeSlug])
    : await pool.query(
        `SELECT COUNT(*)::int AS count FROM audit_log WHERE ts < NOW() - INTERVAL '1 day' * $1`,
        [days]);
  return rows[0].count;
}

export async function purgeOlderThan(days, homeSlug, client) {
  const conn = client || pool;
  const { rowCount } = homeSlug
    ? await conn.query(
        `DELETE FROM audit_log WHERE ts < NOW() - INTERVAL '1 day' * $1 AND home_slug = $2`,
        [days, homeSlug])
    : await conn.query(
        `DELETE FROM audit_log WHERE ts < NOW() - INTERVAL '1 day' * $1`,
        [days]);
  return rowCount;
}

export async function getByHome(homeSlug, limit = 100) {
  const { rows } = await pool.query(
    `SELECT id, ts, action, home_slug, user_name, details
       FROM audit_log
      WHERE home_slug = $1
      ORDER BY ts DESC
      LIMIT $2`,
    [homeSlug, limit]
  );
  return rows.map(r => ({
    ...r,
    ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts,
  }));
}

export async function getByHomeSlugs(slugs, limit = 100) {
  if (!slugs || slugs.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id, ts, action, home_slug, user_name, details
       FROM audit_log
      WHERE home_slug = ANY($1)
      ORDER BY ts DESC
      LIMIT $2`,
    [slugs, limit]
  );
  return rows.map(r => ({
    ...r,
    ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts,
  }));
}

/**
 * Export HR audit entries for a home within a date range.
 * Explicit column list — no SELECT * — so future columns don't auto-leak.
 */
export async function exportHrByHome(homeSlug, from, to) {
  const { rows } = await pool.query(
    `SELECT id, ts, action, home_slug, user_name, details
       FROM audit_log
      WHERE home_slug = $1 AND action LIKE 'hr_%' AND ts >= $2 AND ts <= $3
      ORDER BY ts DESC
      LIMIT 50000`,
    [homeSlug, from, to]
  );
  return rows.map(r => ({
    ...r,
    ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts,
  }));
}
