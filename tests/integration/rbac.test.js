/**
 * Integration tests for per-home role-based access control (RBAC).
 *
 * Covers: requireModule middleware, requireHomeManager middleware,
 * GET /api/homes roleId response, role-based route gating.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';
import * as homeRepo from '../../repositories/homeRepo.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

const PREFIX = 'rbac-test';
const MANAGER_USER = `${PREFIX}-manager`;
const VIEWER_USER = `${PREFIX}-viewer`;
const FINANCE_USER = `${PREFIX}-finance`;
const PW = 'TestRbac!2025x';

let managerToken, viewerToken, financeToken;
let homeId, homeSlug;

beforeAll(async () => {
  // Clean up from previous runs (order matters for FK constraints)
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM users WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM homes WHERE slug = '${PREFIX}-home'`);

  // Create test home with minimal valid config
  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config)
     VALUES ('${PREFIX}-home', 'RBAC Test Home', $1) RETURNING id, slug`,
    [JSON.stringify({ home_name: 'RBAC Test Home', registered_beds: 30 })]
  );
  homeId = home.id;
  homeSlug = home.slug;

  // Create test users with low-cost bcrypt for speed
  const hash = await bcrypt.hash(PW, 4);
  for (const [username, role] of [
    [MANAGER_USER, 'admin'],
    [VIEWER_USER, 'viewer'],
    [FINANCE_USER, 'viewer'],
  ]) {
    await pool.query(
      `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
       VALUES ($1, $2, $3, true, $1, 'test-setup')`,
      [username, hash, role]
    );
  }

  // Assign roles via user_home_roles (new table)
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by) VALUES
      ($1, $4, 'home_manager', 'test-setup'),
      ($2, $4, 'viewer', 'test-setup'),
      ($3, $4, 'finance_officer', 'test-setup')`,
    [MANAGER_USER, VIEWER_USER, FINANCE_USER, homeId]
  );

  // Login all users and capture tokens
  for (const [username, tokenSetter] of [
    [MANAGER_USER, (t) => { managerToken = t; }],
    [VIEWER_USER, (t) => { viewerToken = t; }],
    [FINANCE_USER, (t) => { financeToken = t; }],
  ]) {
    const res = await request(app)
      .post('/api/login')
      .send({ username, password: PW });
    tokenSetter(res.body.token);
  }
}, 15000);

afterAll(async () => {
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM users WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM homes WHERE slug = '${PREFIX}-home'`);
});

// Helper: make authenticated GET with Bearer token
function authGet(path, token) {
  return request(app).get(path).set('Authorization', `Bearer ${token}`);
}

// ── GET /api/homes — returns roleId per home ─────────────────────────────────

describe('GET /api/homes — roleId per home', () => {
  it('manager sees home with roleId: home_manager', async () => {
    const res = await authGet('/api/homes', managerToken).expect(200);
    const home = res.body.find(h => h.id === homeSlug);
    expect(home).toBeDefined();
    expect(home.roleId).toBe('home_manager');
    expect(home.staffId).toBeNull();
    expect(home.clockInRequired).toBe(false);
    expect(typeof home.staffPortalEnabled).toBe('boolean');
  });

  it('viewer sees home with roleId: viewer', async () => {
    const res = await authGet('/api/homes', viewerToken).expect(200);
    const home = res.body.find(h => h.id === homeSlug);
    expect(home).toBeDefined();
    expect(home.roleId).toBe('viewer');
  });

  it('finance_officer sees correct roleId', async () => {
    const res = await authGet('/api/homes', financeToken).expect(200);
    const home = res.body.find(h => h.id === homeSlug);
    expect(home).toBeDefined();
    expect(home.roleId).toBe('finance_officer');
  });

  it('includes scan intake config for home-scoped users', async () => {
    await pool.query(
      `UPDATE homes
       SET config = jsonb_set(
         jsonb_set(COALESCE(config, '{}'::jsonb), '{scan_intake_enabled}', 'true'::jsonb, true),
         '{scan_intake_targets}',
         '["maintenance","finance_ap"]'::jsonb,
         true
       )
       WHERE slug = $1`,
      [homeSlug]
    );

    const res = await authGet('/api/homes', managerToken).expect(200);
    const home = res.body.find(h => h.id === homeSlug);
    expect(home).toBeDefined();
    expect(home.scanIntakeEnabled).toBe(true);
    expect(home.scanIntakeTargets).toEqual(['maintenance', 'finance_ap']);
    expect(home.scanOcrEngine).toBe('paddleocr');
  });

  it('user without role at home does not see it in homes list', async () => {
    // Create a user with no role at our test home
    const noRoleHash = await bcrypt.hash(PW, 4);
    await pool.query(
      `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
       VALUES ('${PREFIX}-norole', $1, 'viewer', true, 'No Role', 'test-setup')
       ON CONFLICT (username) DO NOTHING`,
      [noRoleHash]
    );
    const loginRes = await request(app)
      .post('/api/login')
      .send({ username: `${PREFIX}-norole`, password: PW });
    const noRoleToken = loginRes.body.token;

    const res = await authGet('/api/homes', noRoleToken).expect(200);
    const home = res.body.find(h => h.id === homeSlug);
    expect(home).toBeUndefined();

    // Cleanup
    await pool.query(`DELETE FROM users WHERE username = '${PREFIX}-norole'`);
  });
});

// ── requireHomeAccess + requireModule — route-level gating ──────────────────

describe('requireHomeAccess — resolves homeRole', () => {
  it('manager can access home data', async () => {
    const res = await authGet(`/api/data?home=${homeSlug}`, managerToken);
    // 200 or valid response (home has minimal config, so data load might work)
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it('viewer can access home data', async () => {
    const res = await authGet(`/api/data?home=${homeSlug}`, viewerToken);
    expect(res.status).not.toBe(403);
  });

  it('user without any access gets 403', async () => {
    // Create a user with no home access
    const noAccessHash = await bcrypt.hash(PW, 4);
    await pool.query(
      `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
       VALUES ('${PREFIX}-noaccess', $1, 'viewer', true, 'No Access', 'test-setup')
       ON CONFLICT (username) DO NOTHING`,
      [noAccessHash]
    );
    const loginRes = await request(app)
      .post('/api/login')
      .send({ username: `${PREFIX}-noaccess`, password: PW });
    const noAccessToken = loginRes.body.token;

    const res = await authGet(`/api/data?home=${homeSlug}`, noAccessToken);
    expect(res.status).toBe(403);

    // Cleanup
    await pool.query(`DELETE FROM users WHERE username = '${PREFIX}-noaccess'`);
  });

  it('user without role gets 403', async () => {
    // Create a user with no role assignment
    const noRoleHash = await bcrypt.hash(PW, 4);
    await pool.query(
      `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
       VALUES ('${PREFIX}-norole2', $1, 'admin', true, 'No Role', 'test-setup')
       ON CONFLICT (username) DO NOTHING`,
      [noRoleHash]
    );
    const loginRes = await request(app)
      .post('/api/login')
      .send({ username: `${PREFIX}-norole2`, password: PW });
    const noRoleToken = loginRes.body.token;

    const res = await authGet(`/api/data?home=${homeSlug}`, noRoleToken);
    expect(res.status).toBe(403);

    // Cleanup
    await pool.query(`DELETE FROM users WHERE username = '${PREFIX}-norole2'`);
  });
});

// ── requireModule — module-level gating ─────────────────────────────────────

describe('requireModule — config write gating on PUT /api/homes/config', () => {
  const configPayload = { config: { home_name: 'RBAC Test Home Updated', registered_beds: 30 } };

  it('manager (config:write) can update config', async () => {
    const res = await request(app)
      .put(`/api/homes/config?home=${homeSlug}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send(configPayload);
    // Should succeed (200) or at least not be 403
    expect(res.status).not.toBe(403);
  });

  it('viewer (config:none) cannot update config', async () => {
    const res = await request(app)
      .put(`/api/homes/config?home=${homeSlug}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send(configPayload);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/permissions/i);
  });

  it('finance_officer (config:none) cannot update config', async () => {
    const res = await request(app)
      .put(`/api/homes/config?home=${homeSlug}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send(configPayload);
    expect(res.status).toBe(403);
  });
});

// ── Role assignment boundary ────────────────────────────────────────────────

describe('role assignment boundaries', () => {
  it('user_home_roles row exists for assigned users', async () => {
    const { rows } = await pool.query(
      `SELECT username, role_id FROM user_home_roles
       WHERE home_id = $1 ORDER BY username`,
      [homeId]
    );
    const byUser = Object.fromEntries(rows.map(r => [r.username, r.role_id]));
    expect(byUser[MANAGER_USER]).toBe('home_manager');
    expect(byUser[VIEWER_USER]).toBe('viewer');
    expect(byUser[FINANCE_USER]).toBe('finance_officer');
    // Only users with explicit role assignments should be present
    expect(Object.keys(byUser).length).toBe(3);
  });
});

describe('home config save integrity', () => {
  it('preserves edit_lock_pin when the client payload omits it', async () => {
    await pool.query(
      `UPDATE homes
       SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{edit_lock_pin}', '"1234"'::jsonb, true),
           updated_at = NOW()
       WHERE id = $1`,
      [homeId]
    );
    const { rows: [before] } = await pool.query(`SELECT config, updated_at FROM homes WHERE id = $1`, [homeId]);

    const payload = {
      config: {
        ...before.config,
        home_name: 'RBAC Test Home Pinned',
      },
      _clientUpdatedAt: before.updated_at.toISOString(),
    };
    delete payload.config.edit_lock_pin;

    const res = await request(app)
      .put(`/api/homes/config?home=${homeSlug}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send(payload);

    expect(res.status).toBe(200);
    const { rows: [after] } = await pool.query(`SELECT config FROM homes WHERE id = $1`, [homeId]);
    expect(after.config.edit_lock_pin).toBe('1234');
    expect(after.config.home_name).toBe('RBAC Test Home Pinned');
  });

  it('returns 409 when config is stale after a training config update', async () => {
    const { rows: [before] } = await pool.query(`SELECT config, updated_at FROM homes WHERE id = $1`, [homeId]);
    const staleUpdatedAt = before.updated_at.toISOString();

    await homeRepo.updateTrainingTypesConfig(homeId, [
      {
        id: 'moving-handling',
        name: 'Moving & Handling',
        category: 'mandatory',
        refresher_months: 12,
        roles: ['Carer'],
        active: true,
      },
    ], null, staleUpdatedAt);

    const res = await request(app)
      .put(`/api/homes/config?home=${homeSlug}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        config: {
          ...before.config,
          home_name: 'Stale home config',
        },
        _clientUpdatedAt: staleUpdatedAt,
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/modified by another user/i);
  });
});
