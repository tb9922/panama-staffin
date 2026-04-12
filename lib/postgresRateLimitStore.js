import { pool } from '../db.js';

export class PostgresRateLimitStore {
  constructor({ prefix = 'rate-limit:', cleanupIntervalMs = 10 * 60 * 1000 } = {}) {
    this.prefix = prefix;
    this.cleanupIntervalMs = cleanupIntervalMs;
    this.windowMs = 60 * 1000;
    this.localKeys = false;
    this.lastCleanupAt = 0;
    this.cleanupPromise = null;
  }

  init(options) {
    this.windowMs = options?.windowMs ?? this.windowMs;
  }

  scopedKey(key) {
    return `${this.prefix}${key}`;
  }

  async maybeCleanup() {
    const now = Date.now();
    if (this.cleanupPromise || now - this.lastCleanupAt < this.cleanupIntervalMs) return;
    this.lastCleanupAt = now;
    this.cleanupPromise = pool.query(
      `DELETE FROM rate_limit_hits WHERE reset_at <= NOW()`
    ).catch(() => {
      // Ignore cleanup failures so rate-limited requests still complete.
    }).finally(() => {
      this.cleanupPromise = null;
    });
    await this.cleanupPromise;
  }

  async get(key) {
    const { rows } = await pool.query(
      `SELECT hits, reset_at
         FROM rate_limit_hits
        WHERE key = $1
          AND reset_at > NOW()`,
      [this.scopedKey(key)]
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      totalHits: Number(row.hits) || 0,
      resetTime: row.reset_at,
    };
  }

  async increment(key) {
    await this.maybeCleanup();
    const resetAt = new Date(Date.now() + this.windowMs);
    const { rows } = await pool.query(
      `INSERT INTO rate_limit_hits (key, hits, reset_at, updated_at)
       VALUES ($1, 1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE
           WHEN rate_limit_hits.reset_at <= NOW() THEN 1
           ELSE rate_limit_hits.hits + 1
         END,
         reset_at = CASE
           WHEN rate_limit_hits.reset_at <= NOW() THEN EXCLUDED.reset_at
           ELSE rate_limit_hits.reset_at
         END,
         updated_at = NOW()
       RETURNING hits, reset_at`,
      [this.scopedKey(key), resetAt]
    );
    return {
      totalHits: Number(rows[0]?.hits) || 0,
      resetTime: rows[0]?.reset_at,
    };
  }

  async decrement(key) {
    await pool.query(
      `UPDATE rate_limit_hits
          SET hits = GREATEST(0, hits - 1),
              updated_at = NOW()
        WHERE key = $1`,
      [this.scopedKey(key)]
    );
  }

  async resetKey(key) {
    await pool.query(`DELETE FROM rate_limit_hits WHERE key = $1`, [this.scopedKey(key)]);
  }

  async resetAll() {
    await pool.query(`DELETE FROM rate_limit_hits WHERE key LIKE $1`, [`${this.prefix}%`]);
  }
}
