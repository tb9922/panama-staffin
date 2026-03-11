/**
 * Integration tests for auth + user management routes.
 *
 * Covers: login, JWT validation, role-based access, user CRUD,
 * password management, token revocation, per-home access control.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

const ADMIN_USER = 'auth-test-admin';
const VIEWER_USER = 'auth-test-viewer';
const ADMIN_PW = 'TestAdmin!2025x';
const VIEWER_PW = 'TestViewer!2025x';

let adminToken, viewerToken;
let adminUserId, viewerUserId;
let homeAId, homeBId;

beforeAll(async () => {
  // Clean up from previous runs
  await pool.query(`DELETE FROM user_home_access WHERE username LIKE 'auth-test-%'`);
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE 'auth-test-%'`);
  await pool.query(`DELETE FROM users WHERE username LIKE 'auth-test-%'`);
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'auth-test-%'`);

  // Create test homes
  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ('auth-test-home-a', 'Auth Test Home A', '{}') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ('auth-test-home-b', 'Auth Test Home B', '{}') RETURNING id`
  );
  homeAId = ha.id;
  homeBId = hb.id;

  // Create test users
  const adminHash = await bcrypt.hash(ADMIN_PW, 4);
  const viewerHash = await bcrypt.hash(VIEWER_PW, 4);
  const { rows: [au] } = await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'admin', true, 'Test Admin', 'test-setup') RETURNING id`,
    [ADMIN_USER, adminHash]
  );
  const { rows: [vu] } = await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Test Viewer', 'test-setup') RETURNING id`,
    [VIEWER_USER, viewerHash]
  );
  adminUserId = au.id;
  viewerUserId = vu.id;

  // Grant admin access to both homes, viewer to home A only
  await pool.query(
    `INSERT INTO user_home_access (username, home_id) VALUES ($1, $2), ($1, $3)`,
    [ADMIN_USER, homeAId, homeBId]
  );
  await pool.query(
    `INSERT INTO user_home_access (username, home_id) VALUES ($1, $2)`,
    [VIEWER_USER, homeAId]
  );

  // Create lockout user
  const lockHash = await bcrypt.hash('LockoutTest!2025', 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ('auth-test-lockout', $1, 'viewer', true, 'Lockout User', 'test-setup')`,
    [lockHash]
  );
  await pool.query(
    `INSERT INTO user_home_access (username, home_id) VALUES ('auth-test-lockout', $1)`,
    [homeAId]
  );
}, 15000);

afterAll(async () => {
  await pool.query(
    `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE username LIKE 'auth-test-%'`
  ).catch(() => {});
  await pool.query(`DELETE FROM user_home_access WHERE username LIKE 'auth-test-%'`);
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE 'auth-test-%'`);
  await pool.query(`DELETE FROM users WHERE username LIKE 'auth-test-%'`);
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'auth-test-%'`);
});

// ── Login ────────────────────────────────────────────────────────────────────

describe('POST /api/login', () => {
  it('returns token for valid admin credentials', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: ADMIN_USER, password: ADMIN_PW })
      .expect(200);

    expect(res.body.token).toBeDefined();
    expect(res.body.username).toBe(ADMIN_USER);
    expect(res.body.role).toBe('admin');
    expect(res.body.displayName).toBe('Test Admin');
    adminToken = res.body.token;
  });

  it('returns token for valid viewer credentials', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: VIEWER_USER, password: VIEWER_PW })
      .expect(200);

    expect(res.body.token).toBeDefined();
    expect(res.body.role).toBe('viewer');
    viewerToken = res.body.token;
  });

  it('rejects wrong password with 401 and generic message', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: ADMIN_USER, password: 'wrongpassword' })
      .expect(401);

    expect(res.body.error).toBe('Invalid credentials');
  });

  it('rejects unknown username with same 401 message (anti-enumeration)', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: 'nonexistent-user-xyz', password: 'anything' })
      .expect(401);

    expect(res.body.error).toBe('Invalid credentials');
  });

  it('rejects empty body with 400', async () => {
    await request(app)
      .post('/api/login')
      .send({})
      .expect(400);
  });

  it('rejects missing password with 400', async () => {
    await request(app)
      .post('/api/login')
      .send({ username: ADMIN_USER })
      .expect(400);
  });

  it('rejects deactivated account with same 401 message (anti-enumeration)', async () => {
    // Create and deactivate a user
    const hash = await bcrypt.hash('Deactivated!2025', 4);
    await pool.query(
      `INSERT INTO users (username, password_hash, role, active, created_by)
       VALUES ('auth-test-deactivated', $1, 'viewer', false, 'test-setup')`,
      [hash]
    );

    const res = await request(app)
      .post('/api/login')
      .send({ username: 'auth-test-deactivated', password: 'Deactivated!2025' })
      .expect(401);

    // Same error message as wrong password / unknown user — no enumeration
    expect(res.body.error).toBe('Invalid credentials');

    await pool.query(`DELETE FROM users WHERE username = 'auth-test-deactivated'`);
  });
});

// ── Account Lockout ──────────────────────────────────────────────────────────

describe('Account lockout', () => {
  it('locks account after 5 failed attempts', async () => {
    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/login')
        .send({ username: 'auth-test-lockout', password: 'WrongPassword!123' });
    }

    // 6th attempt with correct password should still fail (locked)
    const res = await request(app)
      .post('/api/login')
      .send({ username: 'auth-test-lockout', password: 'LockoutTest!2025' })
      .expect(401);

    // Same generic message — no indication of lockout (anti-enumeration)
    expect(res.body.error).toBe('Invalid credentials');
  });
});

// ── JWT Validation ───────────────────────────────────────────────────────────

describe('JWT middleware', () => {
  it('rejects request with no Authorization header', async () => {
    await request(app)
      .get('/api/users')
      .expect(401);
  });

  it('rejects request with invalid token', async () => {
    await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer garbage.token.here')
      .expect(401);
  });

  it('rejects request with expired token format', async () => {
    await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VybmFtZSI6InRlc3QiLCJyb2xlIjoiYWRtaW4iLCJleHAiOjF9.invalid')
      .expect(401);
  });

  it('rejects request with non-Bearer auth', async () => {
    await request(app)
      .get('/api/users')
      .set('Authorization', `Basic ${adminToken}`)
      .expect(401);
  });

  it('accepts valid token', async () => {
    await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});

// ── Role-based access ────────────────────────────────────────────────────────

describe('Role-based access control', () => {
  it('admin can access admin-only routes', async () => {
    await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('viewer cannot access admin-only routes', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);

    expect(res.body.error).toMatch(/admin/i);
  });

  it('viewer can access own password change', async () => {
    // This should succeed auth+role check but fail because wrong current password
    const res = await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ currentPassword: 'wrong', newPassword: 'NewViewerPw!2025' });

    // 400 means it passed auth but failed business logic — correct behavior
    expect(res.status).toBe(400);
  });
});

// ── Per-home access control ──────────────────────────────────────────────────

describe('Per-home access control', () => {
  it('admin can access home A (granted)', async () => {
    const res = await request(app)
      .get('/api/scheduling')
      .query({ home: 'auth-test-home-a' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.config).toBeDefined();
  });

  it('admin can access home B (granted)', async () => {
    await request(app)
      .get('/api/scheduling')
      .query({ home: 'auth-test-home-b' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('viewer can access home A (granted)', async () => {
    await request(app)
      .get('/api/scheduling')
      .query({ home: 'auth-test-home-a' })
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
  });

  it('viewer cannot access home B (not granted)', async () => {
    const res = await request(app)
      .get('/api/scheduling')
      .query({ home: 'auth-test-home-b' })
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);

    expect(res.body.error).toMatch(/access/i);
  });

  it('rejects missing home parameter', async () => {
    await request(app)
      .get('/api/scheduling')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('rejects nonexistent home', async () => {
    await request(app)
      .get('/api/scheduling')
      .query({ home: 'nonexistent-home-xyz' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });
});

// ── User CRUD ────────────────────────────────────────────────────────────────

describe('User management (CRUD)', () => {
  let createdUserId;

  it('admin can create a new user', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'auth-test-newuser', password: 'NewUser!2025xx', role: 'viewer', displayName: 'New User' })
      .expect(201);

    expect(res.body.username).toBe('auth-test-newuser');
    expect(res.body.role).toBe('viewer');
    createdUserId = res.body.id;
  });

  it('rejects duplicate username', async () => {
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'auth-test-newuser', password: 'AnotherPw!2025', role: 'admin' })
      .expect(409);
  });

  it('rejects short password', async () => {
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'auth-test-shortpw', password: 'short', role: 'viewer' })
      .expect(400);
  });

  it('admin can list all users', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const usernames = res.body.map(u => u.username);
    expect(usernames).toContain(ADMIN_USER);
    expect(usernames).toContain('auth-test-newuser');
  });

  it('admin can get single user', async () => {
    const res = await request(app)
      .get(`/api/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.username).toBe('auth-test-newuser');
  });

  it('admin can update user role', async () => {
    const res = await request(app)
      .put(`/api/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'admin' })
      .expect(200);

    expect(res.body.role).toBe('admin');
  });

  it('admin can deactivate user', async () => {
    const res = await request(app)
      .put(`/api/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false })
      .expect(200);

    expect(res.body.active).toBe(false);
  });

  it('returns 404 for nonexistent user', async () => {
    await request(app)
      .get('/api/users/999999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('viewer cannot create users', async () => {
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ username: 'auth-test-forbidden', password: 'Forbidden!2025', role: 'viewer' })
      .expect(403);
  });

  afterAll(async () => {
    if (createdUserId) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [createdUserId]);
    }
  });
});

// ── Password management ──────────────────────────────────────────────────────

describe('Password management', () => {
  it('user can change own password', async () => {
    // Login, change password, login with new password
    const newPw = 'ChangedViewer!2025';

    await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ currentPassword: VIEWER_PW, newPassword: newPw })
      .expect(200);

    // Login with new password
    const res = await request(app)
      .post('/api/login')
      .send({ username: VIEWER_USER, password: newPw })
      .expect(200);

    viewerToken = res.body.token;

    // Change back for other tests
    await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ currentPassword: newPw, newPassword: VIEWER_PW })
      .expect(200);

    // Re-login with original password
    const res2 = await request(app)
      .post('/api/login')
      .send({ username: VIEWER_USER, password: VIEWER_PW })
      .expect(200);
    viewerToken = res2.body.token;
  });

  it('rejects wrong current password', async () => {
    const res = await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ currentPassword: 'WrongCurrent!2025', newPassword: 'NewPw!2025xxxx' })
      .expect(400);

    expect(res.body.error).toMatch(/incorrect/i);
  });

  it('admin can reset another user password', async () => {
    const resetPw = 'ResetViewer!2025';

    await request(app)
      .post(`/api/users/${viewerUserId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: resetPw })
      .expect(200);

    // Verify new password works
    const res = await request(app)
      .post('/api/login')
      .send({ username: VIEWER_USER, password: resetPw })
      .expect(200);
    viewerToken = res.body.token;

    // Reset back to original
    await request(app)
      .post(`/api/users/${viewerUserId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: VIEWER_PW })
      .expect(200);

    const res2 = await request(app)
      .post('/api/login')
      .send({ username: VIEWER_USER, password: VIEWER_PW })
      .expect(200);
    viewerToken = res2.body.token;
  });
});

// ── Token revocation ─────────────────────────────────────────────────────────

describe('Token revocation', () => {
  it('admin can revoke a user tokens', async () => {
    // Create a temporary user and login
    const hash = await bcrypt.hash('RevokeTest!2025', 4);
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (username, password_hash, role, active, created_by)
       VALUES ('auth-test-revokee', $1, 'viewer', true, 'test') RETURNING id`,
      [hash]
    );
    await pool.query(
      `INSERT INTO user_home_access (username, home_id) VALUES ('auth-test-revokee', $1)`,
      [homeAId]
    );

    const loginRes = await request(app)
      .post('/api/login')
      .send({ username: 'auth-test-revokee', password: 'RevokeTest!2025' })
      .expect(200);
    const revokeToken = loginRes.body.token;

    // Token works before revocation
    await request(app)
      .get('/api/scheduling')
      .query({ home: 'auth-test-home-a' })
      .set('Authorization', `Bearer ${revokeToken}`)
      .expect(200);

    // Admin revokes
    await request(app)
      .post('/api/login/revoke')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'auth-test-revokee' })
      .expect(200);

    // Token should be denied after revocation
    await request(app)
      .get('/api/scheduling')
      .query({ home: 'auth-test-home-a' })
      .set('Authorization', `Bearer ${revokeToken}`)
      .expect(401);

    // Clean up
    await pool.query(`DELETE FROM token_denylist WHERE username = 'auth-test-revokee'`);
    await pool.query(`DELETE FROM user_home_access WHERE username = 'auth-test-revokee'`);
    await pool.query(`DELETE FROM users WHERE id = $1`, [u.id]);
  });

  it('viewer cannot revoke tokens', async () => {
    await request(app)
      .post('/api/login/revoke')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ username: ADMIN_USER })
      .expect(403);
  });
});

// ── Home access management ───────────────────────────────────────────────────

describe('User home access management', () => {
  it('admin can view user home access', async () => {
    const res = await request(app)
      .get(`/api/users/${viewerUserId}/homes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.homeIds).toContain(homeAId);
    expect(res.body.homeIds).not.toContain(homeBId);
  });

  it('admin can grant home access', async () => {
    await request(app)
      .put(`/api/users/${viewerUserId}/homes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ homeIds: [homeAId, homeBId] })
      .expect(200);

    // Verify viewer can now access home B
    await request(app)
      .get('/api/scheduling')
      .query({ home: 'auth-test-home-b' })
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    // Restore original access (home A only)
    await request(app)
      .put(`/api/users/${viewerUserId}/homes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ homeIds: [homeAId] })
      .expect(200);
  });

  it('admin cannot modify own home access', async () => {
    const res = await request(app)
      .put(`/api/users/${adminUserId}/homes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ homeIds: [homeAId] })
      .expect(400);

    expect(res.body.error).toMatch(/own/i);
  });

  it('admin can list all homes', async () => {
    const res = await request(app)
      .get('/api/users/all-homes')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const slugs = res.body.map(h => h.slug);
    expect(slugs).toContain('auth-test-home-a');
    expect(slugs).toContain('auth-test-home-b');
  });
});
