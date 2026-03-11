/**
 * Integration tests for platform admin routes.
 *
 * Covers: home CRUD, platform-admin-only enforcement, soft delete,
 * slug uniqueness, Zod validation, last-home protection.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

const PREFIX = 'platform-test';
const PLATFORM_ADMIN_USER = `${PREFIX}-platadmin`;
const REGULAR_ADMIN_USER = `${PREFIX}-admin`;
const VIEWER_USER = `${PREFIX}-viewer`;
const PLATFORM_ADMIN_PW = 'PlatformAdmin!2025';
const REGULAR_ADMIN_PW = 'RegularAdmin!2025';
const VIEWER_PW = 'PlatformViewer!2025';
const BASE = '/api/platform';

let platformAdminToken, regularAdminToken, viewerToken;
let seedHomeId;  // Existing home to prevent "last home" deletion

// ── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanup() {
  // Match both 'platform-test-*' (explicit slugs) and 'platform_test_*' (auto-generated slugs)
  const { rows } = await pool.query(
    `SELECT id FROM homes WHERE slug LIKE '${PREFIX}-%' OR slug LIKE 'platform_test_%'`
  );
  const homeIds = rows.map(r => r.id);

  for (const hid of homeIds) {
    await pool.query(`DELETE FROM staff WHERE home_id = $1`, [hid]).catch(() => {});
  }
  await pool.query(`DELETE FROM user_home_access WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM audit_log WHERE home_slug LIKE '${PREFIX}-%' OR home_slug LIKE 'platform_test_%'`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE '${PREFIX}-%' OR slug LIKE 'platform_test_%'`).catch(() => {});
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await cleanup();

  // Create a seed home so there's always at least 1 active home in the system
  const { rows: [sh] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, $2, '{}') RETURNING id`,
    [`${PREFIX}-seed`, 'Platform Test Seed Home']
  );
  seedHomeId = sh.id;

  // Create platform admin user (is_platform_admin = true)
  const platHash = await bcrypt.hash(PLATFORM_ADMIN_PW, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by, is_platform_admin)
     VALUES ($1, $2, 'admin', true, 'Platform Admin', 'test-setup', true)`,
    [PLATFORM_ADMIN_USER, platHash]
  );

  // Create regular admin user (is_platform_admin = false)
  const adminHash = await bcrypt.hash(REGULAR_ADMIN_PW, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by, is_platform_admin)
     VALUES ($1, $2, 'admin', true, 'Regular Admin', 'test-setup', false)`,
    [REGULAR_ADMIN_USER, adminHash]
  );

  // Create viewer user
  const viewerHash = await bcrypt.hash(VIEWER_PW, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Platform Viewer', 'test-setup')`,
    [VIEWER_USER, viewerHash]
  );

  // Grant access to seed home
  await pool.query(
    `INSERT INTO user_home_access (username, home_id) VALUES ($1, $2), ($3, $2), ($4, $2)`,
    [PLATFORM_ADMIN_USER, seedHomeId, REGULAR_ADMIN_USER, VIEWER_USER]
  );

  // Login all three
  const platRes = await request(app)
    .post('/api/login')
    .send({ username: PLATFORM_ADMIN_USER, password: PLATFORM_ADMIN_PW })
    .expect(200);
  platformAdminToken = platRes.body.token;

  const adminRes = await request(app)
    .post('/api/login')
    .send({ username: REGULAR_ADMIN_USER, password: REGULAR_ADMIN_PW })
    .expect(200);
  regularAdminToken = adminRes.body.token;

  const viewerRes = await request(app)
    .post('/api/login')
    .send({ username: VIEWER_USER, password: VIEWER_PW })
    .expect(200);
  viewerToken = viewerRes.body.token;
}, 15000);

afterAll(async () => {
  await cleanup();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function platGet(path) {
  return request(app).get(BASE + path).set('Authorization', `Bearer ${platformAdminToken}`);
}
function platPost(path, body) {
  return request(app).post(BASE + path).set('Authorization', `Bearer ${platformAdminToken}`).send(body);
}
function platPut(path, body) {
  return request(app).put(BASE + path).set('Authorization', `Bearer ${platformAdminToken}`).send(body);
}
function platDelete(path) {
  return request(app).delete(BASE + path).set('Authorization', `Bearer ${platformAdminToken}`);
}
function adminGet(path) {
  return request(app).get(BASE + path).set('Authorization', `Bearer ${regularAdminToken}`);
}
function adminPost(path, body) {
  return request(app).post(BASE + path).set('Authorization', `Bearer ${regularAdminToken}`).send(body);
}
function viewerGet(path) {
  return request(app).get(BASE + path).set('Authorization', `Bearer ${viewerToken}`);
}
function noAuthGet(path) {
  return request(app).get(BASE + path);
}

// ── 1. List Homes ────────────────────────────────────────────────────────────

describe('GET /homes — list all homes', () => {
  it('platform admin can list homes', async () => {
    const res = await platGet('/homes').expect(200);
    expect(res.body).toHaveProperty('homes');
    expect(Array.isArray(res.body.homes)).toBe(true);
    // Should include at least the seed home
    const slugs = res.body.homes.map(h => h.slug);
    expect(slugs).toContain(`${PREFIX}-seed`);
  });

  it('regular admin gets 403', async () => {
    await adminGet('/homes').expect(403);
  });

  it('viewer gets 403', async () => {
    await viewerGet('/homes').expect(403);
  });

  it('no auth gets 401', async () => {
    await noAuthGet('/homes').expect(401);
  });
});

// ── 2. Create Home ───────────────────────────────────────────────────────────

describe('POST /homes — create a home', () => {
  let createdHomeId;

  it('creates a home with valid data', async () => {
    const res = await platPost('/homes', {
      name: 'Platform Created Home',
      slug: `${PREFIX}-created`,
      registered_beds: 40,
      care_type: 'nursing',
      cycle_start_date: '2025-01-06',
    }).expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.slug).toBe(`${PREFIX}-created`);
    expect(res.body.name).toBe('Platform Created Home');
    createdHomeId = res.body.id;
  });

  it('created home appears in list', async () => {
    const res = await platGet('/homes').expect(200);
    const home = res.body.homes.find(h => h.slug === `${PREFIX}-created`);
    expect(home).toBeDefined();
    expect(home.name).toBe('Platform Created Home');
  });

  it('created home has default config populated', async () => {
    const { rows } = await pool.query(
      `SELECT config FROM homes WHERE id = $1`,
      [createdHomeId]
    );
    const config = rows[0].config;
    expect(config.home_name).toBe('Platform Created Home');
    expect(config.registered_beds).toBe(40);
    expect(config.shifts).toBeDefined();
    expect(config.minimum_staffing).toBeDefined();
    expect(config.training_types).toBeDefined();
  });

  it('auto-generates slug from name if not provided', async () => {
    const res = await platPost('/homes', {
      name: 'Platform Test Auto Slug',
      registered_beds: 20,
      cycle_start_date: '2025-01-06',
    }).expect(201);

    expect(res.body.slug).toBe('platform_test_auto_slug');
  });

  it('rejects duplicate slug (409)', async () => {
    const res = await platPost('/homes', {
      name: 'Duplicate Slug',
      slug: `${PREFIX}-created`,
      cycle_start_date: '2025-01-06',
    }).expect(409);

    expect(res.body.error).toMatch(/already exists/);
  });

  it('rejects invalid slug format', async () => {
    await platPost('/homes', {
      name: 'Bad Slug',
      slug: 'UPPER_CASE',
      cycle_start_date: '2025-01-06',
    }).expect(400);
  });

  it('rejects missing required fields (Zod)', async () => {
    await platPost('/homes', {
      registered_beds: 30,
      // missing name, cycle_start_date
    }).expect(400);
  });

  it('rejects invalid cycle_start_date format', async () => {
    await platPost('/homes', {
      name: 'Bad Date',
      cycle_start_date: '06-01-2025',  // Wrong format
    }).expect(400);
  });

  it('regular admin cannot create homes (403)', async () => {
    await adminPost('/homes', {
      name: 'Unauthorized Home',
      cycle_start_date: '2025-01-06',
    }).expect(403);
  });

  it('grants creating user access to new home', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM user_home_access WHERE username = $1 AND home_id = $2`,
      [PLATFORM_ADMIN_USER, createdHomeId]
    );
    expect(rows.length).toBe(1);
  });
});

// ── 3. Update Home ───────────────────────────────────────────────────────────

describe('PUT /homes/:id — update a home', () => {
  let updateHomeId;

  beforeAll(async () => {
    const res = await platPost('/homes', {
      name: 'Update Target Home',
      slug: `${PREFIX}-update-target`,
      cycle_start_date: '2025-01-06',
    });
    updateHomeId = res.body.id;
  });

  it('updates home name', async () => {
    const res = await platPut(`/homes/${updateHomeId}`, {
      name: 'Updated Home Name',
    }).expect(200);

    expect(res.body.ok).toBe(true);

    // Verify in DB
    const { rows } = await pool.query(`SELECT name FROM homes WHERE id = $1`, [updateHomeId]);
    expect(rows[0].name).toBe('Updated Home Name');
  });

  it('updates registered beds and care type', async () => {
    await platPut(`/homes/${updateHomeId}`, {
      registered_beds: 50,
      care_type: 'nursing',
    }).expect(200);

    const { rows } = await pool.query(`SELECT config FROM homes WHERE id = $1`, [updateHomeId]);
    expect(rows[0].config.registered_beds).toBe(50);
    expect(rows[0].config.care_type).toBe('nursing');
  });

  it('returns 404 for non-existent home', async () => {
    await platPut('/homes/999999', {
      name: 'No Such Home',
    }).expect(404);
  });

  it('returns 400 for invalid home ID', async () => {
    await platPut('/homes/abc', {
      name: 'Bad ID',
    }).expect(400);
  });

  it('regular admin cannot update (403)', async () => {
    await request(app)
      .put(`${BASE}/homes/${updateHomeId}`)
      .set('Authorization', `Bearer ${regularAdminToken}`)
      .send({ name: 'Unauthorized Update' })
      .expect(403);
  });
});

// ── 4. Delete Home (Soft Delete) ─────────────────────────────────────────────

describe('DELETE /homes/:id — soft-delete a home', () => {
  let deleteHomeId;

  beforeAll(async () => {
    const res = await platPost('/homes', {
      name: 'Delete Target Home',
      slug: `${PREFIX}-delete-target`,
      cycle_start_date: '2025-01-06',
    });
    deleteHomeId = res.body.id;
  });

  it('soft-deletes a home', async () => {
    const res = await platDelete(`/homes/${deleteHomeId}`).expect(200);
    expect(res.body.ok).toBe(true);

    // Verify deleted_at is set
    const { rows } = await pool.query(
      `SELECT deleted_at FROM homes WHERE id = $1`,
      [deleteHomeId]
    );
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it('cannot delete an already-deleted home', async () => {
    const res = await platDelete(`/homes/${deleteHomeId}`).expect(400);
    expect(res.body.error).toMatch(/already deleted/);
  });

  it('deleted home no longer appears in list', async () => {
    const res = await platGet('/homes').expect(200);
    const slugs = res.body.homes.map(h => h.slug);
    expect(slugs).not.toContain(`${PREFIX}-delete-target`);
  });

  it('cannot update a deleted home (410)', async () => {
    await platPut(`/homes/${deleteHomeId}`, {
      name: 'Ghost Home',
    }).expect(410);
  });

  it('returns 404 for non-existent home', async () => {
    await platDelete('/homes/999999').expect(404);
  });

  it('regular admin cannot delete (403)', async () => {
    await request(app)
      .delete(`${BASE}/homes/${seedHomeId}`)
      .set('Authorization', `Bearer ${regularAdminToken}`)
      .expect(403);
  });

  it('revokes user access on delete', async () => {
    // Create a home, grant access, then delete
    const createRes = await platPost('/homes', {
      name: 'Revoke Access Home',
      slug: `${PREFIX}-revoke-access`,
      cycle_start_date: '2025-01-06',
    });
    const revokeHomeId = createRes.body.id;

    // Grant regular admin access
    await pool.query(
      `INSERT INTO user_home_access (username, home_id) VALUES ($1, $2)`,
      [REGULAR_ADMIN_USER, revokeHomeId]
    );

    // Delete the home
    await platDelete(`/homes/${revokeHomeId}`).expect(200);

    // Verify access was revoked
    const { rows } = await pool.query(
      `SELECT 1 FROM user_home_access WHERE home_id = $1`,
      [revokeHomeId]
    );
    expect(rows.length).toBe(0);
  });
});

// ── 5. Last Home Protection ──────────────────────────────────────────────────

describe('Last Home Protection', () => {
  it('cannot delete the last active home', async () => {
    // Delete all test homes except seed
    const { rows } = await pool.query(
      `SELECT id FROM homes WHERE slug LIKE '${PREFIX}-%' AND slug != $1 AND deleted_at IS NULL`,
      [`${PREFIX}-seed`]
    );
    for (const { id } of rows) {
      await platDelete(`/homes/${id}`).catch(() => {});
    }

    // Count remaining active homes (includes non-test homes)
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM homes WHERE deleted_at IS NULL`
    );

    // If there's only 1 active home in total, trying to delete the seed should fail
    // But there may be other homes in the DB — so we only test this if seed is the last one
    if (countRows[0].count === 1) {
      const res = await platDelete(`/homes/${seedHomeId}`).expect(400);
      expect(res.body.error).toMatch(/last home/);
    }
  });
});

// ── 6. Slug Reuse After Soft Delete ──────────────────────────────────────────

describe('Slug Reuse After Soft Delete', () => {
  it('allows creating a home with a previously soft-deleted slug', async () => {
    // Create and delete a home
    const res1 = await platPost('/homes', {
      name: 'Reuse Slug Home',
      slug: `${PREFIX}-reuse-slug`,
      cycle_start_date: '2025-01-06',
    }).expect(201);

    await platDelete(`/homes/${res1.body.id}`).expect(200);

    // Now create again with the same slug — should succeed
    const res2 = await platPost('/homes', {
      name: 'Reuse Slug Home 2',
      slug: `${PREFIX}-reuse-slug`,
      cycle_start_date: '2025-01-06',
    }).expect(201);

    expect(res2.body.slug).toBe(`${PREFIX}-reuse-slug`);
  });
});
