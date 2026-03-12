import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { AuthenticationError } from '../errors.js';
import * as authRepo from '../repositories/authRepo.js';
import * as userRepo from '../repositories/userRepo.js';
import logger from '../logger.js';

/**
 * Verify deny-list table is reachable on startup.
 * In cluster mode, each instance checks DB on every request (no in-memory Set).
 */
export async function loadDenyList() {
  try {
    const jtis = await authRepo.loadActive();
    const usernames = await authRepo.loadActiveUsernames();
    logger.info({ jtis: jtis.length, usernames: usernames.length }, 'Token deny-list verified');
  } catch (err) {
    // Non-fatal on startup — table may not exist yet (pre-migration)
    logger.warn({ error: err.message }, 'Could not verify token deny-list');
  }
}

export async function login(username, password) {
  // Try database-backed users first
  let dbUser = null;
  try { dbUser = await userRepo.findByUsername(username); } catch {
    // Table may not exist pre-migration — fall through to env-var config
  }

  if (dbUser) {
    if (!dbUser.active) throw new AuthenticationError('Invalid credentials');
    // Account lockout — reject if locked and lockout hasn't expired
    if (dbUser.locked_until && new Date(dbUser.locked_until) > new Date()) {
      throw new AuthenticationError('Invalid credentials');
    }
    const valid = await bcrypt.compare(password, dbUser.password_hash);
    if (!valid) {
      await userRepo.incrementFailedLogin(username);
      throw new AuthenticationError('Invalid credentials');
    }
    // Successful login — reset failed counter and clear username-based deny-list
    // sentinels so the fresh JWT isn't blocked. Trade-off: previously-revoked tokens
    // with remaining TTL (≤4h) could theoretically be reused, but the user is
    // actively re-authenticating which means they're not a terminated employee.
    await userRepo.resetFailedLogin(username);
    await authRepo.clearForUser(username);
    userRepo.updateLastLogin(username).catch(() => {});
    const jti = randomUUID();
    const token = jwt.sign(
      { username: dbUser.username, role: dbUser.role, is_platform_admin: !!dbUser.is_platform_admin, jti },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );
    return { username: dbUser.username, role: dbUser.role, token, displayName: dbUser.display_name || '', isPlatformAdmin: !!dbUser.is_platform_admin };
  }

  // Fallback: env-var users (backward compatibility before migration)
  const envUser = config.users.find(u => u.username === username);
  if (!envUser) throw new AuthenticationError('Invalid credentials');
  const valid = await bcrypt.compare(password, envUser.hash);
  if (!valid) throw new AuthenticationError('Invalid credentials');
  const jti = randomUUID();
  const token = jwt.sign(
    { username: envUser.username, role: envUser.role, jti },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
  return { username: envUser.username, role: envUser.role, token, isPlatformAdmin: false };
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}

/**
 * Check if a decoded token has been revoked.
 * Queries DB directly — cluster-safe (no in-memory Set drift between workers).
 * Single indexed query per authenticated request (~0.1ms on PK lookup).
 * @param {object} decoded - decoded JWT payload
 * @returns {Promise<boolean>}
 */
export async function isTokenDenied(decoded) {
  if (!decoded.jti && !decoded.username) return false;
  return authRepo.isDenied(decoded.jti || null, decoded.username || null);
}

/**
 * Revoke all tokens for a username. Used when terminating staff access.
 * Adds to both DB (persistence across restarts) and in-memory Set (fast checks).
 * @param {string} username
 */
export async function revokeUser(username) {
  await authRepo.revokeAllForUser(username);
  logger.info({ username }, 'All tokens revoked for user');
}

/**
 * Prune expired deny-list entries from DB and refresh memory.
 * Call periodically.
 */
export async function pruneDenyList() {
  const count = await authRepo.pruneExpired();
  if (count > 0) {
    logger.info({ pruned: count }, 'Deny-list pruned');
  }
}
