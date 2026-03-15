import { pool } from '../db.js';
import logger from '../logger.js';

// Data category classification by endpoint prefix
const CATEGORY_MAP = {
  '/api/data':       ['staff', 'scheduling', 'overrides'],
  '/api/payroll':    ['payroll', 'tax', 'pension'],
  '/api/handover':   ['clinical', 'handover'],
  '/api/audit':      ['audit'],
  '/api/export':     ['staff', 'scheduling', 'overrides'],
  '/api/gdpr':       ['gdpr', 'personal_data'],
  '/api/dashboard':  ['compliance', 'staffing'],
  '/api/hr':         ['hr', 'employment'],
  '/api/finance':    ['finance', 'billing'],
  '/api/incidents':  ['clinical', 'safety'],
  '/api/complaints': ['clinical', 'feedback'],
  '/api/training':   ['staff', 'compliance'],
  '/api/dols':       ['clinical', 'dols'],
  '/api/webhooks':   ['system', 'integration'],
};

function classifyCategories(endpoint) {
  for (const [prefix, cats] of Object.entries(CATEGORY_MAP)) {
    if (endpoint.startsWith(prefix)) return cats;
  }
  return [];
}

/**
 * Fire-and-forget access logging middleware.
 * INSERTs on res.finish — never blocks the API response.
 * Failed writes are logged as warnings, not thrown.
 *
 * home_id from req.home (set by requireHomeAccess in route handlers).
 * NULL for home-agnostic routes (audit, platform, users, bank-holidays) — by design.
 * res.finish fires AFTER route handlers complete, so req.home is always available
 * for routes that call requireHomeAccess.
 */
export function accessLog(req, res, next) {
  res.on('finish', () => {
    // Skip health checks and login (login is already rate-limited + audited)
    if (req.url === '/health' || req.url.startsWith('/api/login')) return;

    const categories = classifyCategories(req.url);
    const ip = req.ip || req.connection?.remoteAddress || null;

    pool.query(
      `INSERT INTO access_log (user_name, user_role, method, endpoint, home_id, data_categories, ip_address, status_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8)`,
      [
        req.user?.username || null,
        req.user?.role || null,
        req.method,
        req.url.split('?')[0], // Strip query params (may contain PII)
        req.home?.id || null,
        categories,
        ip,
        res.statusCode,
      ]
    ).catch(err => {
      logger.warn({ err: err.message }, 'access log write failed');
    });
  });
  next();
}
