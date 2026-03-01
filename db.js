import pg from 'pg';
import { config } from './config.js';
import logger from './logger.js';

const { Pool } = pg;

// Return DATE columns as ISO strings ('YYYY-MM-DD'), not JS Date objects.
// Without this, pg interprets DATE as midnight local time — during BST (UTC+1)
// a date like '2026-03-31' becomes 2026-03-30T23:00:00Z, losing a day.
pg.types.setTypeParser(1082, (val) => val);

/** Convert a DATE value to 'YYYY-MM-DD' string. Works with both
 *  Date objects (TIMESTAMP columns) and strings (DATE columns after type parser). */
export function toDateStr(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return typeof v === 'string' ? v : String(v);
}

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  max: config.db.poolMax,
  idleTimeoutMillis: config.db.idleTimeoutMs,
  connectionTimeoutMillis: config.db.connectionTimeoutMs,
  ...(config.db.ssl ? { ssl: config.db.ssl } : {}),
});

pool.on('error', (err) => {
  logger.error({ error: err.message }, 'Unexpected database pool error');
});

// Set per-connection statement timeout so no query runs forever
pool.on('connect', (client) => {
  client.query('SET statement_timeout = 30000').catch(() => {});
});

// Periodic pool stats — warn when clients are waiting for connections
setInterval(() => {
  const { totalCount, idleCount, waitingCount } = pool;
  if (waitingCount > 0) {
    logger.warn({ totalCount, idleCount, waitingCount }, 'DB pool has waiting clients');
  }
}, 300000).unref();

/**
 * Run a function inside a transaction. Rolls back on error.
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
