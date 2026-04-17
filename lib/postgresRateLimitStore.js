import { pool } from '../db.js';

function addWindow(now, windowMs) {
  return new Date(now.getTime() + windowMs);
}

export class PostgresRateLimitStore {
  constructor({ prefix = '' } = {}) {
    this.prefix = prefix;
    this.windowMs = 60_000;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  key(key) {
    return `${this.prefix}${key}`;
  }

  async get(key) {
    const scopedKey = this.key(key);
    const { rows } = await pool.query(
      `SELECT hits, reset_at
         FROM rate_limit_buckets
        WHERE key = $1
          AND reset_at > NOW()`,
      [scopedKey]
    );
    if (!rows[0]) return undefined;
    return {
      totalHits: rows[0].hits,
      resetTime: rows[0].reset_at,
    };
  }

  async increment(key) {
    const scopedKey = this.key(key);
    const now = new Date();
    const resetAt = addWindow(now, this.windowMs);
    const { rows } = await pool.query(
      `INSERT INTO rate_limit_buckets (key, hits, reset_at)
       VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE
       SET hits = CASE
             WHEN rate_limit_buckets.reset_at <= NOW() THEN 1
             ELSE rate_limit_buckets.hits + 1
           END,
           reset_at = CASE
             WHEN rate_limit_buckets.reset_at <= NOW() THEN EXCLUDED.reset_at
             ELSE rate_limit_buckets.reset_at
           END
       RETURNING hits, reset_at`,
      [scopedKey, resetAt]
    );
    return {
      totalHits: rows[0].hits,
      resetTime: rows[0].reset_at,
    };
  }

  async decrement(key) {
    await pool.query(
      `UPDATE rate_limit_buckets
          SET hits = GREATEST(hits - 1, 0)
        WHERE key = $1
          AND reset_at > NOW()`,
      [this.key(key)]
    );
  }

  async resetKey(key) {
    await pool.query('DELETE FROM rate_limit_buckets WHERE key = $1', [this.key(key)]);
  }

  async resetAll() {
    await pool.query('TRUNCATE TABLE rate_limit_buckets');
  }
}
