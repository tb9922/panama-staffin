import { pool } from '../db.js';

export async function log(action, homeSlug, username, details, client) {
  const conn = client || pool;
  await conn.query(
    `INSERT INTO audit_log (action, home_slug, user_name, details) VALUES ($1,$2,$3,$4)`,
    [action, homeSlug || null, username || null, details || null]
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
