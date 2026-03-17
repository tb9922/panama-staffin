import { pool } from '../db.js';

/**
 * Add a JWT to the deny-list. Called when revoking a specific token or all
 * tokens for a user.
 * @param {string} jti - JWT ID (UUID)
 * @param {string} username
 * @param {Date} expiresAt - when the original JWT would naturally expire
 * @param {object} [client] - optional transaction client
 */
export async function addToDenyList(jti, username, expiresAt, client) {
  const conn = client || pool;
  await conn.query(
    `INSERT INTO token_denylist (jti, username, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (jti) DO NOTHING`,
    [jti, username, expiresAt]
  );
}

/**
 * Check if a jti has been revoked.
 * @param {string} jti
 * @returns {Promise<boolean>}
 */
export async function isRevoked(jti) {
  const { rows } = await pool.query(
    'SELECT 1 FROM token_denylist WHERE jti = $1',
    [jti]
  );
  return rows.length > 0;
}

/**
 * Load all active (not yet expired) denied JTIs.
 * Used on startup to populate the in-memory Set.
 * @returns {Promise<string[]>} array of jti strings
 */
export async function loadActive() {
  const { rows } = await pool.query(
    'SELECT jti FROM token_denylist WHERE expires_at > NOW()'
  );
  return rows.map(r => r.jti);
}

/**
 * Load all currently-denied usernames from DB (for in-memory Set rebuild after restart).
 * Only returns usernames with user-scoped revocations (not single-token logouts).
 * @returns {Promise<string[]>}
 */
export async function loadActiveUsernames() {
  const { rows } = await pool.query(
    `SELECT DISTINCT username FROM token_denylist
     WHERE expires_at > NOW() AND username IS NOT NULL AND scope = 'user'`
  );
  return rows.map(r => r.username);
}

/**
 * Remove expired entries from the deny-list.
 * Call periodically (e.g. daily) to keep the table small.
 * @returns {Promise<number>} count of pruned rows
 */
export async function pruneExpired() {
  const { rowCount } = await pool.query(
    'DELETE FROM token_denylist WHERE expires_at <= NOW()'
  );
  return rowCount;
}

/**
 * Revoke all active tokens for a username by inserting a user-scoped sentinel.
 * The middleware checks scope='user' entries by username, blocking all tokens.
 * @param {string} username
 * @param {object} [client]
 */
export async function revokeAllForUser(username, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO token_denylist (jti, username, expires_at, scope)
     VALUES (gen_random_uuid(), $1, NOW() + INTERVAL '24 hours', 'user')
     RETURNING jti`,
    [username]
  );
  return rows[0]?.jti;
}

/**
 * Remove all deny-list entries for a username.
 * Called on successful re-login to prevent old revoked tokens from lingering.
 * @param {string} username
 */
export async function clearForUser(username) {
  await pool.query('DELETE FROM token_denylist WHERE username = $1', [username]);
}

/**
 * Check if a username has any user-scoped revocation entries that are still active.
 * @param {string} username
 * @returns {Promise<boolean>}
 */
export async function isUserRevoked(username) {
  const { rows } = await pool.query(
    `SELECT 1 FROM token_denylist WHERE username = $1 AND scope = 'user' AND expires_at > NOW() LIMIT 1`,
    [username]
  );
  return rows.length > 0;
}

/**
 * Check if a token is denied by jti (single-token logout) or by username
 * with scope='user' (admin revocation of all sessions).
 *
 * Single-token logout (scope='token') only matches the specific jti.
 * User-wide revocation (scope='user') matches all tokens for that username.
 *
 * @param {string|null} jti - JWT ID (UUID string) or null
 * @param {string|null} username
 * @returns {Promise<boolean>}
 */
export async function isDenied(jti, username) {
  if (jti) {
    const { rows } = await pool.query(
      `SELECT 1 FROM token_denylist
       WHERE (jti = $1 AND expires_at > NOW())
          OR (username = $2 AND scope = 'user' AND expires_at > NOW())
       LIMIT 1`,
      [jti, username || '']
    );
    return rows.length > 0;
  }
  // No jti — check user-scoped revocation only
  if (username) {
    const { rows } = await pool.query(
      `SELECT 1 FROM token_denylist
       WHERE username = $1 AND scope = 'user' AND expires_at > NOW()
       LIMIT 1`,
      [username]
    );
    return rows.length > 0;
  }
  return false;
}
