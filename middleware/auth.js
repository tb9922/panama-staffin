import { verifyToken, isTokenDenied } from '../services/authService.js';
import * as homeRepo from '../repositories/homeRepo.js';
import { hasAccess } from '../repositories/userHomeRepo.js';
import { z } from 'zod';

const homeSlugSchema = z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/i, 'Invalid home slug');

export function requireAuth(req, res, next) {
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
      if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return res.status(403).json({ error: 'CSRF token mismatch' });
      }
    }
  }

  try {
    const decoded = verifyToken(token);
    if (isTokenDenied(decoded)) {
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

export function requirePlatformAdmin(req, res, next) {
  if (req.user?.role !== 'admin' || !req.user?.is_platform_admin) {
    return res.status(403).json({ error: 'Platform admin access required' });
  }
  next();
}

/**
 * Middleware: resolve home from ?home= query param, verify user has access.
 * Sets req.home to the home row on success.
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
  const allowed = await hasAccess(req.user.username, home.id);
  if (!allowed) {
    return res.status(403).json({ error: 'You do not have access to this home' });
  }
  req.home = home;
  next();
}
