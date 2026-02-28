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
 * home_id is not resolved here (would require a DB lookup per request).
 * The access_log is global — admin-only via the GDPR dashboard.
 */
export function accessLog(req, res, next) {
  res.on('finish', () => {
    // Skip health checks and login (login is already rate-limited + audited)
    if (req.url === '/health' || req.url.startsWith('/api/login')) return;

    const categories = classifyCategories(req.url);
    const ip = req.ip || req.connection?.remoteAddress || null;

    pool.query(
      `INSERT INTO access_log (user_name, user_role, method, endpoint, home_id, data_categories, ip_address, status_code)
       VALUES ($1, $2, $3, $4, NULL, $5, $6::inet, $7)`,
      [
        req.user?.username || null,
        req.user?.role || null,
        req.method,
        req.url.split('?')[0], // Strip query params (may contain PII)
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
