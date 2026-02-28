import { verifyToken, isTokenDenied } from '../services/authService.js';
import * as homeRepo from '../repositories/homeRepo.js';
import { hasAccess } from '../repositories/userHomeRepo.js';
import { z } from 'zod';

const homeSlugSchema = z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/i, 'Invalid home slug');

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised' });
  try {
    const decoded = verifyToken(auth.slice(7));
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
