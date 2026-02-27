import { verifyToken, isTokenDenied } from '../services/authService.js';

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
