import pg from 'pg';
import { config } from './config.js';
import logger from './logger.js';

const { Pool } = pg;

// Return DATE columns as ISO strings ('YYYY-MM-DD'), not JS Date objects.
pg.types.setTypeParser(1082, (val) => val);

/**
 * Convert a DATE value to 'YYYY-MM-DD' string. Works with both Date objects
 * (TIMESTAMP columns) and strings (DATE columns after the type parser above).
 */
export function toDateStr(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === 'string' ? value : String(value);
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
  options: `-c timezone=UTC -c statement_timeout=${30_000} -c lock_timeout=${10_000} -c idle_in_transaction_session_timeout=${config.db.idleInTransactionTimeoutMs}`,
  ...(config.db.ssl ? { ssl: config.db.ssl } : {}),
});

pool.on('error', (err) => {
  logger.error({ error: err.message }, 'Unexpected database pool error');
});

// Set per-connection safeguards so queries, locks, and idle transactions do not linger forever.
// Periodic pool stats - warn when clients are waiting for connections.
setInterval(() => {
  const { totalCount, idleCount, waitingCount } = pool;
  if (waitingCount > 0) {
    logger.warn({ totalCount, idleCount, waitingCount }, 'DB pool has waiting clients');
  }
}, 30_000).unref();

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
    await client.query('ROLLBACK').catch((rollbackErr) => {
      logger.warn({ error: rollbackErr.message }, 'ROLLBACK failed during error recovery');
    });
    throw err;
  } finally {
    client.release();
  }
}
