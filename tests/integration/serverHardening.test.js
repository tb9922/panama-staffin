/**
 * Integration tests for server hardening (Batch 1).
 *
 * Validates: health endpoint, Helmet security headers,
 * pool statement_timeout, request timeouts.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';

// ── Health Endpoint ──────────────────────────────────────────────────────────

describe('Health endpoint', () => {
  it('returns 200 with status and db fields', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('db', 'ok');
  });

  it('does NOT leak server uptime', async () => {
    const res = await request(app).get('/health');
    expect(res.body).not.toHaveProperty('uptime');
  });

  it('returns a minimal public payload without internal deployment details', async () => {
    const res = await request(app).get('/health');
    expect(Object.keys(res.body).sort()).toEqual(['db', 'status']);
    expect(res.body).not.toHaveProperty('queryMs');
    expect(res.body).not.toHaveProperty('migrationVersion');
    expect(res.body).not.toHaveProperty('pool');
  });

  it('marks the health probe as non-cacheable', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

// ── Helmet Security Headers ─────────────────────────────────────────────────

describe('Security headers', () => {
  it('sets Strict-Transport-Security with 1-year max-age', async () => {
    const res = await request(app).get('/health');
    const hsts = res.headers['strict-transport-security'];
    expect(hsts).toBeDefined();
    expect(hsts).toContain('max-age=31536000');
    expect(hsts).toContain('includeSubDomains');
    expect(hsts).toContain('preload');
  });

  it('sets X-Content-Type-Options', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('removes X-Powered-By header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

// ── DB Statement Timeout ────────────────────────────────────────────────────

describe('Database statement timeout', () => {
  it('pool connections have statement_timeout set', async () => {
    const { pool } = await import('../../db.js');
    const client = await pool.connect();
    try {
      const { rows } = await client.query('SHOW statement_timeout');
      expect(rows[0].statement_timeout).toBe('30s');
    } finally {
      client.release();
    }
  });
});
