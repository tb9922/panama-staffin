import { timingSafeEqual } from 'node:crypto';
import { verifyToken, isTokenDenied } from '../services/authService.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as staffAuthRepo from '../repositories/staffAuthRepo.js';
import { getHomeRole } from '../repositories/userHomeRepo.js';
import { findByUsername as findUserByUsername } from '../repositories/userRepo.js';
import { hasModuleAccess, ROLES, isOwnDataOnly } from '../shared/roles.js';
import { setRequestContext } from '../requestContext.js';
import { z } from 'zod';

const homeSlugSchema = z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/i, 'Invalid home slug');

function authServiceUnavailable(res) {
  return res.status(503).json({ error: 'Authentication service unavailable' });
}

function csrfTokensMatch(cookieToken, headerToken) {
  if (typeof cookieToken !== 'string' || typeof headerToken !== 'string') return false;
  const cookieBuf = Buffer.from(cookieToken, 'utf8');
  const headerBuf = Buffer.from(headerToken, 'utf8');
  if (cookieBuf.length !== headerBuf.length) return false;
  return timingSafeEqual(cookieBuf, headerBuf);
}

async function getAuthDbUser(req) {
  if (req.user?.auth_type === 'staff') {
    req.authDbUser = null;
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(req, 'authDbUser')) {
    return req.authDbUser;
  }
  const dbUser = await findUserByUsername(req.user.username);
  req.authDbUser = dbUser || null;
  return req.authDbUser;
}

async function getActiveAuthDbUser(req, res) {
  try {
    const dbUser = await getAuthDbUser(req);
    return dbUser?.active ? dbUser : null;
  } catch {
    authServiceUnavailable(res);
    return undefined;
  }
}

export async function requireAuth(req, res, next) {
  // Read JWT from HttpOnly cookie first, fall back to Authorization header
  // for backwards compatibility with API clients / integration tests.
  const token = req.cookies?.panama_token
    || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  // CSRF double-submit cookie: on mutating requests from cookie-authenticated users,
  // verify that the X-CSRF-Token header matches the panama_csrf cookie value.
  // An attacker from another origin can cause the cookie to be sent but cannot
  // read its value (same-origin policy), so they cannot forge the header.
  // Safe methods (GET/HEAD/OPTIONS) are exempt - they must not mutate state.
  // If a browser session cookie is present, enforce CSRF even when a Bearer header
  // is also present. That prevents XSS-assisted header injection from bypassing the
  // double-submit protection on cookie-authenticated requests.
  if (req.cookies?.panama_token) {
    const safeMethod = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    if (!safeMethod) {
      const cookieToken = req.cookies.panama_csrf;
      const headerToken = req.headers['x-csrf-token'];
      const tokensMatch = csrfTokensMatch(cookieToken, headerToken);
      if (!tokensMatch) {
        return res.status(403).json({ error: 'CSRF token mismatch' });
      }
    }
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  let denied;
  try {
    denied = await isTokenDenied(decoded);
  } catch {
    return authServiceUnavailable(res);
  }
  if (denied) {
    return res.status(401).json({ error: 'Token has been revoked' });
  }

  try {
    if (decoded.auth_type === 'staff') {
      const creds = await staffAuthRepo.findByStaff(decoded.home_id, decoded.staff_id);
      req.authDbUser = null;
      req.authStaffUser = creds || null;
      if (!creds || !creds.staffActive || (creds.sessionVersion || 0) !== (decoded.session_version || 0)) {
        return res.status(401).json({ error: 'Token has been revoked' });
      }
    } else {
      const dbUser = await findUserByUsername(decoded.username);
      req.authDbUser = dbUser || null;
      if (!dbUser || !dbUser.active || (dbUser.session_version || 0) !== (decoded.session_version || 0)) {
        return res.status(401).json({ error: 'Token has been revoked' });
      }
    }
  } catch {
    return authServiceUnavailable(res);
  }

  req.user = decoded;
  setRequestContext({ username: decoded.username });
  next();
}

export async function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden - admin role required' });
  // Re-verify role from DB - JWT claim may be stale (admin downgraded after last login).
  // Without this, a demoted admin retains requireAdmin access for the JWT's remaining TTL.
  const dbUser = await getActiveAuthDbUser(req, res);
  if (dbUser === undefined) return;
  if (dbUser?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden - admin role required' });
  }
  next();
}

export async function requirePlatformAdmin(req, res, next) {
  if (req.user?.role !== 'admin' || !req.user?.is_platform_admin) {
    return res.status(403).json({ error: 'Platform admin access required' });
  }
  // Re-verify from DB - JWT claim may be stale (platform admin demoted after last login).
  // Without this, a terminated platform admin retains full access for the JWT's remaining TTL.
  const dbUser = await getActiveAuthDbUser(req, res);
  if (dbUser === undefined) return;
  if (!dbUser?.is_platform_admin) {
    return res.status(403).json({ error: 'Platform admin access required' });
  }
  next();
}

/**
 * Middleware: resolve home from ?home= query param, verify user has access.
 * Sets req.home, req.homeRole, and req.staffId.
 * Must be used AFTER requireAuth (needs req.user).
 */
export async function requireHomeAccess(req, res, next) {
  const p = homeSlugSchema.safeParse(req.query.home);
  if (!p.success || !p.data) {
    return res.status(400).json({ error: 'home parameter is required' });
  }
  const home = await homeRepo.findBySlug(p.data);
  if (!home) {
    return res.status(404).json({ error: 'Home not found' });
  }

  // Platform admins bypass per-home role check - they have implicit home_manager access.
  // Re-verify from DB - JWT claim may be stale (admin demoted after last login).
  if (req.user.is_platform_admin) {
    const dbUser = await getActiveAuthDbUser(req, res);
    if (dbUser === undefined) return;
    if (dbUser?.is_platform_admin) {
      req.home = home;
      req.homeRole = 'home_manager';
      req.staffId = null;
      setRequestContext({ homeSlug: home.slug });
      return next();
    }
    // Stale claim - clear it and fall through to per-home role check.
    req.user.is_platform_admin = false;
  }

  if (req.user.auth_type === 'staff') {
    if (req.user.home_id !== home.id || req.user.home_slug !== home.slug) {
      return res.status(403).json({ error: 'You do not have access to this home' });
    }
    req.home = home;
    req.homeRole = 'staff_member';
    req.staffId = req.user.staff_id || null;
    setRequestContext({ homeSlug: home.slug });
    return next();
  }

  // Resolve per-home role from user_home_roles.
  const assignment = await getHomeRole(req.user.username, home.id);
  if (!assignment) {
    return res.status(403).json({ error: 'You do not have access to this home' });
  }

  req.home = home;
  req.homeRole = assignment.role_id;
  req.staffId = assignment.staff_id || null;
  setRequestContext({ homeSlug: home.slug });
  next();
}

/**
 * Module permission check - replaces requireAdmin for most routes.
 * Usage: requireModule('payroll', 'write')
 * Must be used AFTER requireHomeAccess (needs req.homeRole).
 * @param {string} moduleId - one of MODULES
 * @param {string} level - 'read' | 'write'
 * @param {{ allowOwn?: boolean }} options
 */
export function requireModule(moduleId, level = 'read', options = {}) {
  const { allowOwn = false } = options;
  return (req, res, next) => {
    // Platform admins bypass module checks - only if requireHomeAccess already ran and
    // re-verified the DB claim (indicated by req.homeRole being set).
    // This prevents a stale JWT claim from bypassing checks on routes that skip requireHomeAccess.
    if (req.user.is_platform_admin && req.homeRole != null) return next();

    if (allowOwn && level === 'read' && isOwnDataOnly(req.homeRole, moduleId)) {
      return next();
    }

    if (!hasModuleAccess(req.homeRole, moduleId, level, { includeOwn: false })) {
      return res.status(403).json({ error: `Insufficient permissions for ${moduleId}` });
    }
    next();
  };
}

/**
 * Home manager check - for user management within a home.
 * Must be used AFTER requireHomeAccess (needs req.homeRole).
 */
export function requireHomeManager(req, res, next) {
  // Same guard as requireModule - only bypass if requireHomeAccess already re-verified the claim.
  if (req.user.is_platform_admin && req.homeRole != null) return next();
  const role = ROLES[req.homeRole];
  if (!role?.canManageUsers) {
    return res.status(403).json({ error: 'Home Manager role required' });
  }
  next();
}

export function requireStaffSelf(req, res, next) {
  if (req.user?.role !== 'staff_member' || req.user?.auth_type !== 'staff') {
    return res.status(403).json({ error: 'Staff endpoint only' });
  }
  req.staffId = req.user.staff_id || null;
  req.homeId = req.user.home_id || null;
  if (!req.staffId || !req.homeId) {
    return res.status(403).json({ error: 'No staff link configured' });
  }
  next();
}
