import crypto from 'crypto';
import { pool } from '../db.js';
import logger from '../logger.js';

const KEY_RE = /^[A-Za-z0-9._:-]{8,160}$/;
const DEFAULT_TTL_HOURS = 24;

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function requestHash(req) {
  const body = stableStringify(req.body ?? null);
  const subject = [
    req.method,
    req.baseUrl || '',
    (req.originalUrl || req.path || '').split('?')[0],
    req.home?.id ?? '',
    req.user?.username ?? '',
    body,
  ].join('|');
  return crypto.createHash('sha256').update(subject).digest('hex');
}

async function cleanupExpired() {
  await pool.query('DELETE FROM request_idempotency WHERE expires_at < NOW()');
}

export function idempotency(scope, { ttlHours = DEFAULT_TTL_HOURS } = {}) {
  return async function idempotencyMiddleware(req, res, next) {
    const key = req.get('Idempotency-Key');
    if (!key) return next();
    if (!KEY_RE.test(key)) {
      return res.status(400).json({ error: 'Invalid Idempotency-Key header' });
    }

    const hash = requestHash(req);
    const homeId = req.home?.id ?? 0;
    const username = req.user?.username || 'anonymous';

    try {
      if (Math.random() < 0.01) cleanupExpired().catch(() => {});

      const inserted = await pool.query(
        `INSERT INTO request_idempotency
             (scope, idempotency_key, request_hash, home_id, user_name, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'in_progress', NOW() + ($6::int * INTERVAL '1 hour'))
         ON CONFLICT (scope, idempotency_key, home_id, user_name) DO NOTHING
         RETURNING id`,
        [scope, key, hash, homeId, username, ttlHours],
      );

      if (inserted.rowCount === 0) {
        const existing = await pool.query(
          `SELECT request_hash, status, response_status, response_body
             FROM request_idempotency
            WHERE scope = $1
              AND idempotency_key = $2
              AND home_id = $3
              AND user_name = $4
              AND expires_at >= NOW()`,
          [scope, key, homeId, username],
        );
        const row = existing.rows[0];
        if (!row) return next();
        if (row.request_hash !== hash) {
          return res.status(409).json({ error: 'Idempotency-Key was reused with a different request body' });
        }
        if (row.status === 'completed') {
          res.setHeader('Idempotent-Replay', 'true');
          return res.status(row.response_status || 200).json(row.response_body ?? {});
        }
        return res.status(409).json({ error: 'A request with this Idempotency-Key is already in progress' });
      }

      let capturedBody;
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        capturedBody = body;
        return originalJson(body);
      };

      res.on('finish', () => {
        const completed = res.statusCode >= 200 && res.statusCode < 300 && capturedBody !== undefined;
        const query = completed
          ? pool.query(
            `UPDATE request_idempotency
                SET status = 'completed',
                    response_status = $5,
                    response_body = $6::jsonb,
                    updated_at = NOW()
              WHERE scope = $1 AND idempotency_key = $2 AND home_id = $3 AND user_name = $4`,
            [scope, key, homeId, username, res.statusCode, JSON.stringify(capturedBody ?? null)],
          )
          : pool.query(
            `DELETE FROM request_idempotency
              WHERE scope = $1 AND idempotency_key = $2 AND home_id = $3 AND user_name = $4`,
            [scope, key, homeId, username],
          );
        query.catch((err) => logger.warn({ err: err?.message, scope }, 'idempotency finalise failed'));
      });

      return next();
    } catch (err) {
      logger.warn({ err: err?.message, scope }, 'idempotency middleware failed open');
      return next();
    }
  };
}
