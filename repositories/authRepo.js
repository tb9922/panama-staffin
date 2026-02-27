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
 * @returns {Promise<string[]>}
 */
export async function loadActiveUsernames() {
  const { rows } = await pool.query(
    `SELECT DISTINCT username FROM token_denylist
     WHERE expires_at > NOW() AND username IS NOT NULL`
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
 * Revoke all active tokens for a username by inserting a wildcard entry.
 * Since we don't track every issued jti, this inserts a sentinel row
 * with the username. The middleware checks both jti and username.
 * @param {string} username
 * @param {object} [client]
 */
export async function revokeAllForUser(username, client) {
  const conn = client || pool;
  // Insert a sentinel with a generated UUID — the middleware will check by username
  const { rows } = await conn.query(
    `INSERT INTO token_denylist (jti, username, expires_at)
     VALUES (gen_random_uuid(), $1, NOW() + INTERVAL '12 hours')
     RETURNING jti`,
    [username]
  );
  return rows[0]?.jti;
}

/**
 * Check if a username has any revocation entries that are still active.
 * @param {string} username
 * @returns {Promise<boolean>}
 */
export async function isUserRevoked(username) {
  const { rows } = await pool.query(
    'SELECT 1 FROM token_denylist WHERE username = $1 AND expires_at > NOW() LIMIT 1',
    [username]
  );
  return rows.length > 0;
}
