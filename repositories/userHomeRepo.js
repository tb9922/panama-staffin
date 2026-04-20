import { pool } from '../db.js';

// ── Role-based access (user_home_roles table) ─────────────────────────

/**
 * Get a user's role assignment for a home.
 * @param {string} username
 * @param {number} homeId
 * @returns {Promise<{role_id: string, staff_id: string|null}|null>}
 */
export async function getHomeRole(username, homeId) {
  const { rows } = await pool.query(
    `SELECT uhr.role_id, uhr.staff_id FROM user_home_roles uhr
     JOIN users u ON u.username = uhr.username AND u.active = true
     WHERE uhr.username = $1 AND uhr.home_id = $2 LIMIT 1`,
    [username, homeId]
  );
  return rows[0] || null;
}

/**
 * Assign a role to a user for a specific home. Upserts (replaces existing role).
 * @param {string} username
 * @param {number} homeId
 * @param {string} roleId
 * @param {string|null} staffId — only for staff_member role
 * @param {string} grantedBy
 * @param {object} [client] — optional transaction client
 */
export async function assignRole(username, homeId, roleId, staffId, grantedBy, client) {
  const conn = client || pool;
  await conn.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, staff_id, granted_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (username, home_id) DO UPDATE SET
       role_id = EXCLUDED.role_id,
       staff_id = EXCLUDED.staff_id,
       granted_by = EXCLUDED.granted_by,
       granted_at = NOW()`,
    [username, homeId, roleId, staffId || null, grantedBy]
  );
}

/**
 * Remove a user's role assignment for a home.
 * @param {string} username
 * @param {number} homeId
 * @param {object} [client] — optional transaction client
 */
export async function removeRole(username, homeId, client) {
  const conn = client || pool;
  await conn.query(
    'DELETE FROM user_home_roles WHERE username = $1 AND home_id = $2',
    [username, homeId]
  );
}

/**
 * Get all role assignments for a user (across all homes).
 * Used by /api/homes to return roleId per home.
 * @param {string} username
 * @returns {Promise<Array<{home_id: number, role_id: string, staff_id: string|null}>>}
 */
export async function findRolesForUser(username, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT home_id, role_id, staff_id FROM user_home_roles WHERE username = $1`,
    [username]
  );
  return rows;
}

/**
 * Get all homes a user can access, with their role assignment.
 * Single joined query — used by GET /api/homes to return roleId per home.
 * @param {string} username
 * @returns {Promise<Array<{slug: string, name: string, config: object, role_id: string, staff_id: string|null}>>}
 */
export async function findHomesWithRolesForUser(username) {
  const { rows } = await pool.query(
    `SELECT h.slug, h.name, h.config, uhr.role_id, uhr.staff_id
     FROM user_home_roles uhr
     JOIN homes h ON h.id = uhr.home_id AND h.deleted_at IS NULL
     JOIN users u ON u.username = uhr.username AND u.active = true
     WHERE uhr.username = $1
     ORDER BY h.name`,
    [username]
  );
  return rows;
}

/**
 * Get all role assignments for a home (all users).
 * Used by the user management page.
 * @param {number} homeId
 * @returns {Promise<Array<{username: string, role_id: string, staff_id: string|null, granted_by: string, granted_at: Date}>>}
 */
export async function findRolesForHome(homeId) {
  const { rows } = await pool.query(
    `SELECT username, role_id, staff_id, granted_by, granted_at
     FROM user_home_roles WHERE home_id = $1 ORDER BY username`,
    [homeId]
  );
  return rows;
}

/**
 * Revoke all role assignments for a home (used when soft-deleting a home).
 * @param {number} homeId
 * @param {object} [client] — optional transaction client
 */
export async function revokeAllRolesForHome(homeId, client) {
  const conn = client || pool;
  await conn.query('DELETE FROM user_home_roles WHERE home_id = $1', [homeId]);
}

export async function revokeAllRolesForUser(username, client) {
  const conn = client || pool;
  await conn.query('DELETE FROM user_home_roles WHERE username = $1', [username]);
}

/**
 * Grant home_manager role on all existing homes (used when creating platform admin).
 * @param {string} username
 * @param {object} [client] — optional transaction client
 */
export async function grantAllHomesRole(username, client) {
  const conn = client || pool;
  await conn.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
       SELECT $1, id, 'home_manager', 'system'
       FROM homes WHERE deleted_at IS NULL FOR SHARE
       ON CONFLICT (username, home_id) DO NOTHING`,
    [username]
  );
}

// ── Access queries (all via user_home_roles) ────────────────────────────

/**
 * Check if a user has access to a specific home.
 * Returns true if the user has a role assignment for this home.
 */
export async function hasAccess(username, homeId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM user_home_roles uhr
     JOIN users u ON u.username = uhr.username AND u.active = true
     WHERE uhr.username = $1 AND uhr.home_id = $2 LIMIT 1`,
    [username, homeId]
  );
  return rows.length > 0;
}

/**
 * Get all home IDs a user can access.
 * @param {string} username
 * @param {object} [client] — optional transaction client
 */
export async function findHomeIdsForUser(username, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT home_id FROM user_home_roles WHERE username = $1',
    [username]
  );
  return rows.map(r => r.home_id);
}

/**
 * Get all home slugs a user can access.
 */
export async function findHomeSlugsForUser(username) {
  const { rows } = await pool.query(
    `SELECT h.slug FROM user_home_roles uhr
     JOIN homes h ON h.id = uhr.home_id AND h.deleted_at IS NULL
     JOIN users u ON u.username = uhr.username AND u.active = true
     WHERE uhr.username = $1`,
    [username]
  );
  return rows.map(r => r.slug);
}

/**
 * Get all usernames with a role at a home.
 * Used to capture affected users in audit before revoking.
 */
export async function findUsernamesForHome(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT username FROM user_home_roles WHERE home_id = $1',
    [homeId]
  );
  return rows.map(r => r.username);
}
