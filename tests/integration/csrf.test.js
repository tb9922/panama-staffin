/**
 * Integration tests for CSRF double-submit cookie protection.
 *
 * Verifies that:
 * - Login sets the panama_csrf cookie
 * - Mutating requests with correct token succeed
 * - Mutating requests without token get 403
 * - Logout clears the panama_csrf cookie
 * - GET requests work without CSRF token
 * - Authorization header bypasses CSRF check
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';

const PREFIX = 'csrf-test';
const ADMIN_USER = `${PREFIX}-admin`;
const ADMIN_PW = 'CsrfTestAdmin!2025';

let homeId;
let bearerToken;

beforeAll(async () => {
  // Clean up previous test data
  await pool.query(`DELETE FROM user_home_access WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE '${PREFIX}-%'`);

  // Create test home
  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('${PREFIX}-home', 'CSRF Test Home') RETURNING id`
  );
  homeId = home.id;

  // Create admin user
  const hash = await bcrypt.hash(ADMIN_PW, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, display_name) VALUES ($1, $2, 'admin', 'CSRF Admin')`,
    [ADMIN_USER, hash]
  );
  await pool.query(
    `INSERT INTO user_home_access (username, home_id) VALUES ($1, $2)`,
    [ADMIN_USER, homeId]
  );

  // Get a Bearer token for non-cookie tests
  const loginRes = await request(app)
    .post('/api/login')
    .send({ username: ADMIN_USER, password: ADMIN_PW })
    .expect(200);
  bearerToken = loginRes.body.token;
}, 15000);

afterAll(async () => {
  await pool.query(`DELETE FROM user_home_access WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE '${PREFIX}-%'`);
});

describe('CSRF double-submit cookie', () => {
  it('login sets panama_csrf cookie', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: ADMIN_USER, password: ADMIN_PW })
      .expect(200);

    const cookies = res.headers['set-cookie'];
    const csrfCookie = cookies.find(c => c.startsWith('panama_csrf='));
    expect(csrfCookie).toBeDefined();
    // Should NOT be httpOnly (JS needs to read it)
    expect(csrfCookie).not.toContain('HttpOnly');
    // Should be SameSite=Strict
    expect(csrfCookie).toContain('SameSite=Strict');
  });

  it('POST with matching cookie + header succeeds', async () => {
    // Login to get cookies
    const loginRes = await request(app)
      .post('/api/login')
      .send({ username: ADMIN_USER, password: ADMIN_PW })
      .expect(200);

    const cookies = loginRes.headers['set-cookie'];
    // Pick the real CSRF cookie (not the clearCookie for old path)
    const csrfCookie = cookies.find(c => c.startsWith('panama_csrf=') && !c.includes('Expires=Thu, 01 Jan 1970'));
    const csrfToken = csrfCookie.split('=')[1].split(';')[0];

    // Use cookies for a mutating request
    const res = await request(app)
      .post('/api/login/logout')
      .set('Cookie', cookies.filter(c => !c.includes('Expires=Thu, 01 Jan 1970')).map(c => c.split(';')[0]).join('; '))
      .set('X-CSRF-Token', csrfToken)
      .expect(200);

    expect(res.body.ok).toBe(true);
  });

  it('POST with cookie auth but no CSRF token returns 403', async () => {
    const loginRes = await request(app)
      .post('/api/login')
      .send({ username: ADMIN_USER, password: ADMIN_PW })
      .expect(200);

    const cookies = loginRes.headers['set-cookie'];
    // Strip panama_csrf from cookies but keep panama_token
    const tokenCookie = cookies.find(c => c.startsWith('panama_token=')).split(';')[0];

    const res = await request(app)
      .post('/api/login/logout')
      .set('Cookie', tokenCookie)
      .expect(403);

    expect(res.body.error).toBe('CSRF token mismatch');
  });

  it('POST with mismatched CSRF token returns 403', async () => {
    const loginRes = await request(app)
      .post('/api/login')
      .send({ username: ADMIN_USER, password: ADMIN_PW })
      .expect(200);

    const cookies = loginRes.headers['set-cookie'];

    const res = await request(app)
      .post('/api/login/logout')
      .set('Cookie', cookies.filter(c => !c.includes('Expires=Thu, 01 Jan 1970')).map(c => c.split(';')[0]).join('; '))
      .set('X-CSRF-Token', 'wrong-token-value')
      .expect(403);

    expect(res.body.error).toBe('CSRF token mismatch');
  });

  it('GET request works without CSRF token (safe method)', async () => {
    const loginRes = await request(app)
      .post('/api/login')
      .send({ username: ADMIN_USER, password: ADMIN_PW })
      .expect(200);

    const cookies = loginRes.headers['set-cookie'];
    // Strip panama_csrf to prove GET doesn't need it
    const tokenCookie = cookies.find(c => c.startsWith('panama_token=')).split(';')[0];

    const res = await request(app)
      .get('/api/homes')
      .set('Cookie', tokenCookie)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('Authorization header bypasses CSRF check', async () => {
    // This is the path all integration tests use — must keep working
    const res = await request(app)
      .post('/api/login/logout')
      .set('Authorization', `Bearer ${bearerToken}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
  });

  it('logout clears panama_csrf cookie', async () => {
    const loginRes = await request(app)
      .post('/api/login')
      .send({ username: ADMIN_USER, password: ADMIN_PW })
      .expect(200);

    const cookies = loginRes.headers['set-cookie'];
    const csrfCookie = cookies.find(c => c.startsWith('panama_csrf=') && !c.includes('Expires=Thu, 01 Jan 1970'));
    const csrfToken = csrfCookie.split('=')[1].split(';')[0];

    const logoutRes = await request(app)
      .post('/api/login/logout')
      .set('Cookie', cookies.filter(c => !c.includes('Expires=Thu, 01 Jan 1970')).map(c => c.split(';')[0]).join('; '))
      .set('X-CSRF-Token', csrfToken)
      .expect(200);

    // Logout should clear the csrf cookie
    const logoutCookies = logoutRes.headers['set-cookie'];
    const clearedCsrf = logoutCookies?.find(c => c.startsWith('panama_csrf='));
    expect(clearedCsrf).toBeDefined();
    // Cleared cookies have empty value or Expires in the past
    expect(
      clearedCsrf.includes('Expires=Thu, 01 Jan 1970') || clearedCsrf.includes('panama_csrf=;')
    ).toBe(true);
  });

  it('each login generates a unique CSRF token', async () => {
    const res1 = await request(app)
      .post('/api/login')
      .send({ username: ADMIN_USER, password: ADMIN_PW })
      .expect(200);
    const res2 = await request(app)
      .post('/api/login')
      .send({ username: ADMIN_USER, password: ADMIN_PW })
      .expect(200);

    const token1 = res1.headers['set-cookie'].find(c => c.startsWith('panama_csrf=') && !c.includes('Expires=Thu, 01 Jan 1970')).split('=')[1].split(';')[0];
    const token2 = res2.headers['set-cookie'].find(c => c.startsWith('panama_csrf=') && !c.includes('Expires=Thu, 01 Jan 1970')).split('=')[1].split(';')[0];

    expect(token1).not.toBe(token2);
    expect(token1.length).toBe(64); // 32 bytes hex = 64 chars
  });
});
