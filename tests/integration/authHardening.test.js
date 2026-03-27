/**
 * Integration tests for auth hardening (Batch 2).
 *
 * Validates: account lockout after failed logins, password complexity,
 * role change token revocation.
 *
 * Requires: PostgreSQL running with migrations applied (incl. 087).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';
import { validatePassword } from '../../services/userService.js';
import * as userService from '../../services/userService.js';
import * as authService from '../../services/authService.js';
import * as authRepo from '../../repositories/authRepo.js';
import * as userRepo from '../../repositories/userRepo.js';

const TEST_PREFIX = 'lockout-test';
const ADMIN_USER = `${TEST_PREFIX}-admin`;
const LOCKOUT_USER = `${TEST_PREFIX}-target`;
const ADMIN_PW = 'AdminPass1Test';
const LOCKOUT_PW = 'LockoutPass1Test';

let adminToken;
let lockoutUserId;

beforeAll(async () => {
  // Clean up
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE '${TEST_PREFIX}-%'`);

  await pool.query(`DELETE FROM token_denylist WHERE username LIKE '${TEST_PREFIX}-%'`);
  await pool.query(`DELETE FROM users WHERE username LIKE '${TEST_PREFIX}-%'`);
  await pool.query(`DELETE FROM homes WHERE slug LIKE '${TEST_PREFIX}-%'`);

  // Create test home
  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ('${TEST_PREFIX}-home', 'Lockout Test Home', '{}') RETURNING id`
  );

  // Create admin user (platform admin + home_manager)
  const adminHash = await bcrypt.hash(ADMIN_PW, 10);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by, is_platform_admin)
     VALUES ($1, $2, 'admin', true, 'Test Admin', 'test-setup', true)`,
    [ADMIN_USER, adminHash]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'home_manager', 'test-setup')`,
    [ADMIN_USER, home.id]
  );

  // Create lockout target user
  const lockoutHash = await bcrypt.hash(LOCKOUT_PW, 10);
  const { rows: [lu] } = await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Lockout Target', 'test-setup') RETURNING id`,
    [LOCKOUT_USER, lockoutHash]
  );
  lockoutUserId = lu.id;
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'viewer', 'test-setup')`,
    [LOCKOUT_USER, home.id]
  );

  // Login as admin
  const res = await request(app).post('/api/login').send({ username: ADMIN_USER, password: ADMIN_PW });
  adminToken = res.body.token;
}, 15000);

afterAll(async () => {
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE '${TEST_PREFIX}-%'`);

  await pool.query(`DELETE FROM token_denylist WHERE username LIKE '${TEST_PREFIX}-%'`);
  await pool.query(`DELETE FROM users WHERE username LIKE '${TEST_PREFIX}-%'`);
  await pool.query(`DELETE FROM homes WHERE slug LIKE '${TEST_PREFIX}-%'`);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Password Complexity ─────────────────────────────────────────────────────

describe('Password complexity', () => {
  it('rejects password without uppercase', () => {
    expect(validatePassword('lowercase1only')).toContain('uppercase');
  });

  it('rejects password without lowercase', () => {
    expect(validatePassword('UPPERCASE1ONLY')).toContain('lowercase');
  });

  it('rejects password without number', () => {
    expect(validatePassword('NoNumbersHere')).toContain('number');
  });

  it('rejects short password', () => {
    expect(validatePassword('Ab1')).toContain('at least');
  });

  it('accepts valid complex password', () => {
    expect(validatePassword('ValidPass1Test')).toBeNull();
  });

  it('accepts password with special characters', () => {
    expect(validatePassword('Str0ng!Pass#2025')).toBeNull();
  });
});

// ── Account Lockout ─────────────────────────────────────────────────────────

describe('Account lockout', () => {
  beforeAll(async () => {
    // Reset lockout state before these tests
    await pool.query(
      'UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE username = $1',
      [LOCKOUT_USER]
    );
  });

  it('increments failed_login_count on wrong password', async () => {
    await request(app).post('/api/login').send({ username: LOCKOUT_USER, password: 'WrongPass1' });
    const { rows } = await pool.query(
      'SELECT failed_login_count FROM users WHERE username = $1',
      [LOCKOUT_USER]
    );
    expect(rows[0].failed_login_count).toBe(1);
  });

  it('locks account after 5 failed attempts', async () => {
    // Already have 1 failure from above, add 4 more
    for (let i = 0; i < 4; i++) {
      await request(app).post('/api/login').send({ username: LOCKOUT_USER, password: 'WrongPass1' });
    }
    const { rows } = await pool.query(
      'SELECT failed_login_count, locked_until FROM users WHERE username = $1',
      [LOCKOUT_USER]
    );
    expect(rows[0].failed_login_count).toBe(5);
    expect(rows[0].locked_until).not.toBeNull();
  });

  it('rejects correct password while locked (generic error to prevent enumeration)', async () => {
    const res = await request(app).post('/api/login').send({ username: LOCKOUT_USER, password: LOCKOUT_PW });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('allows login after lockout expires', async () => {
    // Manually set locked_until to the past
    await pool.query(
      "UPDATE users SET locked_until = NOW() - INTERVAL '1 minute' WHERE username = $1",
      [LOCKOUT_USER]
    );
    const res = await request(app).post('/api/login').send({ username: LOCKOUT_USER, password: LOCKOUT_PW });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('resets failed count on successful login', async () => {
    const { rows } = await pool.query(
      'SELECT failed_login_count, locked_until FROM users WHERE username = $1',
      [LOCKOUT_USER]
    );
    expect(rows[0].failed_login_count).toBe(0);
    expect(rows[0].locked_until).toBeNull();
  });
});

// ── Per-home Role Change: DB-checked, no token revocation ───────────────────
//
// Per-home roles are read from the DB on every authenticated request via
// requireHomeAccess. There is no JWT claim for per-home roles, so revocation
// is unnecessary — the new role takes effect immediately without invalidating
// the existing token.

describe('Per-home role change takes effect without token revocation', () => {
  it('existing token still works after per-home role changes', async () => {
    // Login as lockout user to get a token
    const loginRes = await request(app).post('/api/login').send({ username: LOCKOUT_USER, password: LOCKOUT_PW });
    expect(loginRes.status).toBe(200);
    const userToken = loginRes.body.token;

    // Admin changes lockout user's role at this home
    const roleRes = await request(app)
      .put(`/api/users/${lockoutUserId}/roles`)
      .query({ home: `${TEST_PREFIX}-home` })
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleId: 'deputy_manager' });
    expect(roleRes.status).toBe(200);

    // Token should still be valid — per-home roles are DB-checked, not JWT-cached
    const checkRes = await request(app)
      .get('/api/homes')
      .set('Authorization', `Bearer ${userToken}`);
    expect(checkRes.status).toBe(200);

    // Change role back to viewer for cleanup
    await request(app)
      .put(`/api/users/${lockoutUserId}/roles`)
      .query({ home: `${TEST_PREFIX}-home` })
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleId: 'viewer' });
  }, 15000);
});

describe('Session and logout hardening', () => {
  it('returns 503 when auth dependency checks fail instead of forcing a 401 logout', async () => {
    vi.spyOn(authService, 'isTokenDenied').mockRejectedValueOnce(new Error('db down'));

    const res = await request(app)
      .get('/api/homes')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(503);

    expect(res.body.error).toMatch(/authentication service unavailable/i);
  });

  it('rejects a deactivated platform admin token on /api/homes', async () => {
    const loginRes = await request(app).post('/api/login').send({ username: ADMIN_USER, password: ADMIN_PW });
    expect(loginRes.status).toBe(200);
    const staleToken = loginRes.body.token;

    await pool.query('UPDATE users SET active = false WHERE username = $1', [ADMIN_USER]);

    await request(app)
      .get('/api/homes')
      .set('Authorization', `Bearer ${staleToken}`)
      .expect(401);

    await pool.query('UPDATE users SET active = true WHERE username = $1', [ADMIN_USER]);
  });

  it('fails closed when logout deny-list persistence fails', async () => {
    vi.spyOn(authRepo, 'addToDenyList').mockRejectedValueOnce(new Error('db down'));
    const loginRes = await request(app).post('/api/login').send({ username: LOCKOUT_USER, password: LOCKOUT_PW });
    expect(loginRes.status).toBe(200);
    const userToken = loginRes.body.token;

    const res = await request(app)
      .post('/api/login/logout')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(503);

    expect(res.body.error).toMatch(/logout failed/i);
    const setCookies = res.headers['set-cookie'] || [];
    expect(setCookies.some(cookie => cookie.startsWith('panama_token=;'))).toBe(false);

    await request(app)
      .get('/api/homes')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
  });

  it('reuses the authenticated DB user lookup on platform-admin home requests', async () => {
    const spy = vi.spyOn(userRepo, 'findByUsername');

    await request(app)
      .get('/api/homes')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(ADMIN_USER);
  });
});

describe('Password updates are atomic', () => {
  it('resetPassword rolls back if revokeUser fails', async () => {
    await pool.query(
      "UPDATE users SET failed_login_count = 3, locked_until = NOW() + INTERVAL '5 minutes' WHERE id = $1",
      [lockoutUserId]
    );
    const before = await pool.query(
      'SELECT password_hash, session_version, failed_login_count, locked_until FROM users WHERE id = $1',
      [lockoutUserId]
    );

    vi.spyOn(authService, 'revokeUser').mockRejectedValueOnce(new Error('denylist down'));

    await expect(userService.resetPassword(lockoutUserId, 'FreshReset1X', ADMIN_USER))
      .rejects.toThrow(/denylist down/i);

    const after = await pool.query(
      'SELECT password_hash, session_version, failed_login_count, locked_until FROM users WHERE id = $1',
      [lockoutUserId]
    );
    expect(after.rows[0].password_hash).toBe(before.rows[0].password_hash);
    expect(after.rows[0].session_version).toBe(before.rows[0].session_version);
    expect(after.rows[0].failed_login_count).toBe(3);
    expect(after.rows[0].locked_until).not.toBeNull();
  });

  it('changeOwnPassword rolls back if revokeUser fails', async () => {
    await pool.query(
      'UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1',
      [lockoutUserId]
    );
    const before = await pool.query(
      'SELECT password_hash, session_version FROM users WHERE username = $1',
      [LOCKOUT_USER]
    );

    vi.spyOn(authService, 'revokeUser').mockRejectedValueOnce(new Error('denylist down'));

    await expect(userService.changeOwnPassword(LOCKOUT_USER, LOCKOUT_PW, 'ChangedOwn1X'))
      .rejects.toThrow(/denylist down/i);

    const after = await pool.query(
      'SELECT password_hash, session_version FROM users WHERE username = $1',
      [LOCKOUT_USER]
    );
    expect(after.rows[0].password_hash).toBe(before.rows[0].password_hash);
    expect(after.rows[0].session_version).toBe(before.rows[0].session_version);
  });
});
