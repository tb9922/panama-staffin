import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { AuthenticationError } from '../errors.js';
import * as authRepo from '../repositories/authRepo.js';
import * as userRepo from '../repositories/userRepo.js';
import logger from '../logger.js';

// In-memory deny-list for fast lookups (jti Set + username Set)
const deniedJtis = new Set();
const deniedUsernames = new Set();

/**
 * Load active deny-list entries from DB into memory.
 * Called once on startup.
 */
export async function loadDenyList() {
  try {
    const jtis = await authRepo.loadActive();
    jtis.forEach(jti => deniedJtis.add(jti));
    const usernames = await authRepo.loadActiveUsernames();
    usernames.forEach(u => deniedUsernames.add(u));
    logger.info({ jtis: jtis.length, usernames: usernames.length }, 'Token deny-list loaded');
  } catch (err) {
    // Non-fatal on startup — table may not exist yet (pre-migration)
    logger.warn({ error: err.message }, 'Could not load token deny-list');
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
    // Successful login — reset failed counter and clear deny entry
    await userRepo.resetFailedLogin(username);
    deniedUsernames.delete(username);
    userRepo.updateLastLogin(username).catch(() => {});
    const jti = randomUUID();
    const token = jwt.sign(
      { username: dbUser.username, role: dbUser.role, jti },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );
    return { username: dbUser.username, role: dbUser.role, token, displayName: dbUser.display_name || '' };
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
  return { username: envUser.username, role: envUser.role, token };
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}

/**
 * Check if a decoded token has been revoked.
 * Checks both the specific jti and the username.
 * @param {object} decoded - decoded JWT payload
 * @returns {boolean}
 */
export function isTokenDenied(decoded) {
  if (decoded.jti && deniedJtis.has(decoded.jti)) return true;
  if (decoded.username && deniedUsernames.has(decoded.username)) return true;
  return false;
}

/**
 * Revoke all tokens for a username. Used when terminating staff access.
 * Adds to both DB (persistence across restarts) and in-memory Set (fast checks).
 * @param {string} username
 */
export async function revokeUser(username) {
  await authRepo.revokeAllForUser(username);
  deniedUsernames.add(username);
  logger.info({ username }, 'All tokens revoked for user');
}

/**
 * Prune expired deny-list entries from DB and refresh memory.
 * Call periodically.
 */
export async function pruneDenyList() {
  const count = await authRepo.pruneExpired();
  if (count > 0) {
    // Rebuild in-memory sets from DB after pruning
    deniedJtis.clear();
    deniedUsernames.clear();
    const jtis = await authRepo.loadActive();
    jtis.forEach(j => deniedJtis.add(j));
    const usernames = await authRepo.loadActiveUsernames();
    usernames.forEach(u => deniedUsernames.add(u));
    logger.info({ pruned: count, active: jtis.length }, 'Deny-list pruned');
  }
}
