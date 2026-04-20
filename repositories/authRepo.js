import { pool } from '../db.js';
import { config } from '../config.js';

function parseJwtExpiresIn(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000;
  if (typeof value !== 'string') return 4 * 60 * 60 * 1000;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10) * 1000;
  const match = trimmed.match(/^(\d+)\s*([smhd])$/i);
  if (!match) return 4 * 60 * 60 * 1000;
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const unitMs = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return amount * unitMs[unit];
}

function getRevocationExpiry() {
  return new Date(Date.now() + parseJwtExpiresIn(config.jwtExpiresIn));
}

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
 * Revoke all active tokens for a username by inserting a sentinel.
 * scope='user' — password change / self-initiated: cleared on re-login.
 * scope='admin' — admin-initiated: survives re-login so a terminated
 *   employee cannot clear the block by authenticating with their password.
 * @param {string} username
 * @param {string} [scope='user']
 * @param {object} [client]
 */
export async function revokeAllForUser(username, scope = 'user', client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO token_denylist (jti, username, expires_at, scope)
     VALUES (gen_random_uuid(), $1, $2, $3)
     RETURNING jti`,
    [username, getRevocationExpiry(), scope]
  );
  return rows[0]?.jti;
}

/**
 * Remove all deny-list entries for a username except admin-initiated revocations.
 * Called on successful re-login to prevent stale sentinels (password change,
 * role change) from blocking the freshly-issued token.
 * scope='admin' entries are deliberately preserved: an attacker who
 * knows the password cannot clear an admin block by re-logging in.
 * @param {string} username
 */
export async function clearForUser(username) {
  await pool.query("DELETE FROM token_denylist WHERE username = $1 AND scope = 'user'", [username]);
}

/**
 * Check if a username has any user-scoped revocation entries that are still active.
 * @param {string} username
 * @returns {Promise<boolean>}
 */
export async function isUserRevoked(username) {
  const { rows } = await pool.query(
    `SELECT 1 FROM token_denylist WHERE username = $1 AND scope IN ('user', 'admin') AND expires_at > NOW() LIMIT 1`,
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
          OR (username = $2 AND scope IN ('user', 'admin') AND expires_at > NOW())
       LIMIT 1`,
      [jti, username || '']
    );
    return rows.length > 0;
  }
  // No jti — check user-scoped revocation only
  if (username) {
    const { rows } = await pool.query(
      `SELECT 1 FROM token_denylist
       WHERE username = $1 AND scope IN ('user', 'admin') AND expires_at > NOW()
       LIMIT 1`,
      [username]
    );
    return rows.length > 0;
  }
  // Neither jti nor username — cannot determine status; deny by default (defense-in-depth)
  return true;
}
