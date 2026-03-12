import { pool } from '../db.js';

// ── Role-based access (new: user_home_roles table) ────────────────────

/**
 * Get a user's role assignment for a home from user_home_roles.
 * Falls back to user_home_access + users.role for backward compatibility
 * during the migration transition.
 * @param {string} username
 * @param {number} homeId
 * @returns {Promise<{role_id: string, staff_id: string|null}|null>}
 */
export async function getHomeRole(username, homeId) {
  // Try new table first
  const { rows } = await pool.query(
    'SELECT role_id, staff_id FROM user_home_roles WHERE username = $1 AND home_id = $2 LIMIT 1',
    [username, homeId]
  );
  if (rows.length > 0) return rows[0];

  // Fallback: check legacy user_home_access + infer role from users.role
  const { rows: legacy } = await pool.query(
    `SELECT u.role FROM user_home_access uha
     JOIN users u ON u.username = uha.username
     WHERE uha.username = $1 AND uha.home_id = $2 LIMIT 1`,
    [username, homeId]
  );
  if (legacy.length > 0) {
    return { role_id: legacy[0].role === 'admin' ? 'home_manager' : 'viewer', staff_id: null };
  }
  return null;
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
export async function findRolesForUser(username) {
  const { rows } = await pool.query(
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

/**
 * Grant home_manager role on all existing homes (used when creating platform admin).
 * @param {string} username
 */
export async function grantAllHomesRole(username) {
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
       SELECT $1, id, 'home_manager', 'system'
       FROM homes WHERE deleted_at IS NULL FOR SHARE
       ON CONFLICT (username, home_id) DO NOTHING`,
    [username]
  );
}

// ── Legacy access (user_home_access table — kept for backward compat) ──

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
export async function grantAccess(username, homeId, client) {
  const conn = client || pool;
  await conn.query(
    'INSERT INTO user_home_access (username, home_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [username, homeId]
  );
}

/**
 * Revoke a user's access to a home.
 */
export async function revokeAccess(username, homeId, client) {
  const conn = client || pool;
  await conn.query(
    'DELETE FROM user_home_access WHERE username = $1 AND home_id = $2',
    [username, homeId]
  );
}

/**
 * Get all home IDs a user can access.
 */
export async function findHomeIdsForUser(username, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
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
     JOIN homes h ON h.id = uha.home_id AND h.deleted_at IS NULL
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
       SELECT $1, id FROM homes WHERE deleted_at IS NULL FOR SHARE
       ON CONFLICT DO NOTHING`,
    [username]
  );
}

/**
 * Revoke all user access to a specific home.
 * Used when soft-deleting a home. Accepts transaction client.
 */
export async function revokeAllForHome(homeId, client) {
  const conn = client || pool;
  await conn.query(
    'DELETE FROM user_home_access WHERE home_id = $1',
    [homeId]
  );
}

/**
 * Get all usernames with access to a home.
 * Used to capture affected users in audit before revoking.
 */
export async function findUsernamesForHome(homeId) {
  const { rows } = await pool.query(
    'SELECT username FROM user_home_access WHERE home_id = $1',
    [homeId]
  );
  return rows.map(r => r.username);
}
