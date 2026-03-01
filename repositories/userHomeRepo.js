import { pool } from '../db.js';

/**
 * Check if a user has access to a specific home.
 * Returns true if the user has an explicit grant for this home.
 */
export async function hasAccess(username, homeId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM user_home_access WHERE username = $1 AND home_id = $2 LIMIT 1',
    [username, homeId]
  );
  return rows.length > 0;
}

/**
 * Grant a user access to a home. Idempotent (ON CONFLICT DO NOTHING).
 */
export async function grantAccess(username, homeId) {
  await pool.query(
    'INSERT INTO user_home_access (username, home_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [username, homeId]
  );
}

/**
 * Revoke a user's access to a home.
 */
export async function revokeAccess(username, homeId) {
  await pool.query(
    'DELETE FROM user_home_access WHERE username = $1 AND home_id = $2',
    [username, homeId]
  );
}

/**
 * Get all home IDs a user can access.
 */
export async function findHomeIdsForUser(username) {
  const { rows } = await pool.query(
    'SELECT home_id FROM user_home_access WHERE username = $1',
    [username]
  );
  return rows.map(r => r.home_id);
}

/**
 * Get all home slugs a user can access.
 * Used by the homes list endpoint where listAll() returns slug-based IDs.
 */
export async function findHomeSlugsForUser(username) {
  const { rows } = await pool.query(
    `SELECT h.slug FROM user_home_access uha
     JOIN homes h ON h.id = uha.home_id
     WHERE uha.username = $1`,
    [username]
  );
  return rows.map(r => r.slug);
}

/**
 * Grant a user access to all existing homes.
 * Used when seeding a new admin or during initial setup.
 */
export async function grantAllHomes(username) {
  await pool.query(
    `INSERT INTO user_home_access (username, home_id)
       SELECT $1, id FROM homes FOR SHARE
       ON CONFLICT DO NOTHING`,
    [username]
  );
}
