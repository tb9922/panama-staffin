import { timingSafeEqual } from 'node:crypto';
import { verifyToken, isTokenDenied } from '../services/authService.js';
import * as homeRepo from '../repositories/homeRepo.js';
import { getHomeRole } from '../repositories/userHomeRepo.js';
import { findByUsername as findUserByUsername } from '../repositories/userRepo.js';
import { hasModuleAccess, ROLES } from '../shared/roles.js';
import { z } from 'zod';

const homeSlugSchema = z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/i, 'Invalid home slug');

export async function requireAuth(req, res, next) {
  // Read JWT from HttpOnly cookie first, fall back to Authorization header
  // for backwards compatibility with API clients / integration tests.
  const token = req.cookies?.panama_token
    || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  // CSRF double-submit cookie: on mutating requests from cookie-authenticated users,
  // verify that the X-CSRF-Token header matches the panama_csrf cookie value.
  // An attacker from another origin can cause the cookie to be sent but cannot
  // read its value (same-origin policy), so they can't forge the header.
  // Safe methods (GET/HEAD/OPTIONS) are exempt — they must not mutate state.
  // Authorization header requests are exempt (API clients handle their own CSRF).
  if (req.cookies?.panama_token && !req.headers.authorization) {
    const safeMethod = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    if (!safeMethod) {
      const cookieToken = req.cookies.panama_csrf;
      const headerToken = req.headers['x-csrf-token'];
      const tokensMatch = cookieToken && headerToken &&
        cookieToken.length === headerToken.length &&
        timingSafeEqual(Buffer.from(cookieToken, 'utf8'), Buffer.from(headerToken, 'utf8'));
      if (!tokensMatch) {
        return res.status(403).json({ error: 'CSRF token mismatch' });
      }
    }
  }

  try {
    const decoded = verifyToken(token);
    const denied = await isTokenDenied(decoded);
    if (denied) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden — admin role required' });
  next();
}

export async function requirePlatformAdmin(req, res, next) {
  if (req.user?.role !== 'admin' || !req.user?.is_platform_admin) {
    return res.status(403).json({ error: 'Platform admin access required' });
  }
  // Re-verify from DB — JWT claim may be stale (platform admin demoted after last login).
  // Without this, a terminated platform admin retains full access for the JWT's remaining TTL.
  try {
    const dbUser = await findUserByUsername(req.user.username);
    if (!dbUser?.is_platform_admin) {
      return res.status(403).json({ error: 'Platform admin access required' });
    }
  } catch {
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

  // Platform admins bypass per-home role check — they have implicit home_manager access.
  // Re-verify from DB — JWT claim may be stale (admin demoted after last login).
  if (req.user.is_platform_admin) {
    try {
      const dbUser = await findUserByUsername(req.user.username);
      if (dbUser?.is_platform_admin) {
        req.home = home;
        req.homeRole = 'home_manager';
        req.staffId = null;
        return next();
      }
      // Stale claim — clear it and fall through to per-home role check
      req.user.is_platform_admin = false;
    } catch {
      req.user.is_platform_admin = false;
    }
  }

  // Resolve per-home role from user_home_roles
  const assignment = await getHomeRole(req.user.username, home.id);
  if (!assignment) {
    return res.status(403).json({ error: 'You do not have access to this home' });
  }

  req.home = home;
  req.homeRole = assignment.role_id;
  req.staffId = assignment.staff_id || null;
  next();
}

/**
 * Module permission check — replaces requireAdmin for most routes.
 * Usage: requireModule('payroll', 'write')
 * Must be used AFTER requireHomeAccess (needs req.homeRole).
 * @param {string} moduleId — one of MODULES
 * @param {string} level — 'read' | 'write'
 */
export function requireModule(moduleId, level = 'read') {
  return (req, res, next) => {
    // Platform admins bypass module checks — only if requireHomeAccess already ran and
    // re-verified the DB claim (indicated by req.homeRole being set).
    // This prevents a stale JWT claim from bypassing checks on routes that skip requireHomeAccess.
    if (req.user.is_platform_admin && req.homeRole !== undefined) return next();

    if (!hasModuleAccess(req.homeRole, moduleId, level)) {
      return res.status(403).json({ error: `Insufficient permissions for ${moduleId}` });
    }
    next();
  };
}

/**
 * Home manager check — for user management within a home.
 * Must be used AFTER requireHomeAccess (needs req.homeRole).
 */
export function requireHomeManager(req, res, next) {
  // Same guard as requireModule — only bypass if requireHomeAccess already re-verified the claim
  if (req.user.is_platform_admin && req.homeRole !== undefined) return next();
  const role = ROLES[req.homeRole];
  if (!role?.canManageUsers) {
    return res.status(403).json({ error: 'Home Manager role required' });
  }
  next();
}
