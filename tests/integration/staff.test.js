/**
 * Integration tests for staff CRUD routes + scheduling PII filtering.
 *
 * Covers: create, update, optimistic locking, soft delete, cascade delete,
 * PII filtering for viewer role, cross-home isolation, admin-only enforcement.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

const PREFIX = 'staff-test';
const BCRYPT_ROUNDS = 4;
const ADMIN_USER = `${PREFIX}-admin`;
const VIEWER_USER = `${PREFIX}-viewer`;
const ADMIN_PW = 'StaffTestAdmin!2025';
const VIEWER_PW = 'StaffTestViewer!2025';

let adminToken, viewerToken;
let homeAId, homeBId;
let homeASlug, homeBSlug;

beforeAll(async () => {
  // Clean up from previous runs
  await pool.query(`DELETE FROM shift_overrides WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE '${PREFIX}-%')`);
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE '${PREFIX}-%')`);
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM users WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM homes WHERE slug LIKE '${PREFIX}-%'`);

  // Create test homes
  homeASlug = `${PREFIX}-home-a`;
  homeBSlug = `${PREFIX}-home-b`;
  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Staff Test Home A', '{"home_name":"Staff Test Home A"}') RETURNING id`,
    [homeASlug]
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Staff Test Home B', '{"home_name":"Staff Test Home B"}') RETURNING id`,
    [homeBSlug]
  );
  homeAId = ha.id;
  homeBId = hb.id;

  // Create test users
  const adminHash = await bcrypt.hash(ADMIN_PW, BCRYPT_ROUNDS);
  const viewerHash = await bcrypt.hash(VIEWER_PW, BCRYPT_ROUNDS);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'admin', true, 'Staff Test Admin', 'test-setup')`,
    [ADMIN_USER, adminHash]
  );
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Staff Test Viewer', 'test-setup')`,
    [VIEWER_USER, viewerHash]
  );

  // Grant access: admin → both homes, viewer → home A only
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by) VALUES ($1, $2, 'home_manager', 'test-setup'), ($1, $3, 'home_manager', 'test-setup')`,
    [ADMIN_USER, homeAId, homeBId]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by) VALUES ($1, $2, 'viewer', 'test-setup')`,
    [VIEWER_USER, homeAId]
  );

  // Login both users
  const adminRes = await request(app)
    .post('/api/login')
    .send({ username: ADMIN_USER, password: ADMIN_PW })
    .expect(200);
  adminToken = adminRes.body.token;

  const viewerRes = await request(app)
    .post('/api/login')
    .send({ username: VIEWER_USER, password: VIEWER_PW })
    .expect(200);
  viewerToken = viewerRes.body.token;
}, 30000);

afterAll(async () => {
  await pool.query(`DELETE FROM shift_overrides WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE '${PREFIX}-%')`);
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE '${PREFIX}-%')`);
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM users WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM homes WHERE slug LIKE '${PREFIX}-%'`);
}, 30000);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStaff(overrides = {}) {
  return {
    id: 'ST001',
    name: 'Jane Smith',
    role: 'Senior Carer',
    team: 'Day A',
    pref: 'E',
    skill: 3,
    hourly_rate: 14.50,
    active: true,
    wtr_opt_out: false,
    start_date: '2024-06-01',
    contract_hours: 37.5,
    date_of_birth: '1990-03-15',
    ni_number: 'AB123456C',
    al_entitlement: 28,
    al_carryover: 3,
    ...overrides,
  };
}

// ── Staff Creation ──────────────────────────────────────────────────────────

describe('POST /api/staff — create', () => {
  afterAll(async () => {
    // Clean up created staff for this block
    await pool.query(
      `DELETE FROM staff WHERE home_id = $1 AND id IN ('ST001', 'ST002', 'ST003', 'ST004', 'S150', 'S151')`,
      [homeAId]
    );
  });

  it('admin can create a staff member', async () => {
    const staff = makeStaff();
    const res = await request(app)
      .post('/api/staff')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send(staff)
      .expect(201);

    expect(res.body.id).toBe('ST001');
    expect(res.body.name).toBe('Jane Smith');
    expect(res.body.role).toBe('Senior Carer');
    expect(res.body.hourly_rate).toBe(14.5);
    expect(res.body.ni_number).toBe('AB123456C');
    expect(res.body.version).toBe(1);
  });

  it('rejects missing required fields', async () => {
    const res = await request(app)
      .post('/api/staff')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: 'ST002' })
      .expect(400);

    expect(res.body.error).toBeTruthy();
    expect(res.body.details).toBeDefined();
  });

  it('rejects invalid role', async () => {
    const staff = makeStaff({ id: 'ST002', role: 'Janitor' });
    await request(app)
      .post('/api/staff')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send(staff)
      .expect(400);
  });

  it('rejects invalid NI number format', async () => {
    const staff = makeStaff({ id: 'ST002', ni_number: 'INVALID' });
    await request(app)
      .post('/api/staff')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send(staff)
      .expect(400);
  });

  it('viewer cannot create staff', async () => {
    const staff = makeStaff({ id: 'ST003' });
    await request(app)
      .post('/api/staff')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${viewerToken}`)
      .send(staff)
      .expect(403);
  });

  it('increments version when POST upserts an existing staff member', async () => {
    const initial = await request(app)
      .post('/api/staff')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send(makeStaff({ id: 'ST004', name: 'Upsert Target', hourly_rate: 13.25 }))
      .expect(201);

    const updated = await request(app)
      .post('/api/staff')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send(makeStaff({ id: 'ST004', name: 'Upsert Target Updated', hourly_rate: 13.75 }))
      .expect(201);

    expect(initial.body.version).toBe(1);
    expect(updated.body.version).toBe(2);
    expect(updated.body.name).toBe('Upsert Target Updated');
    expect(updated.body.hourly_rate).toBe(13.75);
  });

  it('auto-generates the next S-prefixed staff ID after a manually supplied higher ID', async () => {
    await request(app)
      .post('/api/staff')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send(makeStaff({ id: 'S150', name: 'Manual Counter Seed' }))
      .expect(201);

    const res = await request(app)
      .post('/api/staff')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send(makeStaff({ id: undefined, name: 'Auto Generated Staff' }))
      .expect(201);

    expect(res.body.id).toBe('S151');
  });

  it('rejects request with no home parameter', async () => {
    const staff = makeStaff({ id: 'ST003' });
    await request(app)
      .post('/api/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(staff)
      .expect(400);
  });
});

// ── Staff Update ────────────────────────────────────────────────────────────

describe('PUT /api/staff/:id — update', () => {
  beforeAll(async () => {
    // Seed a staff member for update tests
    await pool.query(
      `INSERT INTO staff (home_id, id, name, role, team, skill, hourly_rate, active, version)
       VALUES ($1, 'ST010', 'Update Target', 'Carer', 'Day B', 2, 13.00, true, 1)`,
      [homeAId]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM staff WHERE home_id = $1 AND id = 'ST010'`, [homeAId]);
  });

  it('admin can update staff fields', async () => {
    const res = await request(app)
      .put('/api/staff/ST010')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated Name', hourly_rate: 15.00 })
      .expect(200);

    expect(res.body.name).toBe('Updated Name');
    expect(res.body.hourly_rate).toBe(15);
  });

  it('optimistic locking rejects stale version', async () => {
    // First get current version
    const current = await pool.query(
      `SELECT version FROM staff WHERE home_id = $1 AND id = 'ST010' AND deleted_at IS NULL`,
      [homeAId]
    );
    const staleVersion = current.rows[0].version - 1;

    const res = await request(app)
      .put('/api/staff/ST010')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Stale Update', _version: staleVersion })
      .expect(409);

    expect(res.body.error).toMatch(/modified/i);
  });

  it('update without _version succeeds', async () => {
    const res = await request(app)
      .put('/api/staff/ST010')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ skill: 4 })
      .expect(200);

    expect(res.body.skill).toBe(4);
  });

  it('returns 404 for nonexistent staff', async () => {
    await request(app)
      .put('/api/staff/NONEXISTENT')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ghost' })
      .expect(404);
  });

  it('viewer cannot update staff', async () => {
    await request(app)
      .put('/api/staff/ST010')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Viewer Update' })
      .expect(403);
  });
});

// ── Staff Deletion ──────────────────────────────────────────────────────────

describe('DELETE /api/staff/:id — soft delete', () => {
  beforeAll(async () => {
    // Seed staff + override for cascade test
    await pool.query(
      `INSERT INTO staff (home_id, id, name, role, team, skill, hourly_rate, active, version)
       VALUES ($1, 'ST020', 'Delete Target', 'Carer', 'Day A', 1, 12.50, true, 1)`,
      [homeAId]
    );
    await pool.query(
      `INSERT INTO shift_overrides (home_id, date, staff_id, shift, reason, source)
       VALUES ($1, '2026-03-01', 'ST020', 'AL', 'test leave', 'al')`,
      [homeAId]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1 AND staff_id = 'ST020'`, [homeAId]);
    await pool.query(`DELETE FROM staff WHERE home_id = $1 AND id = 'ST020'`, [homeAId]);
  });

  it('admin can soft-delete staff', async () => {
    await pool.query(
      `UPDATE staff SET updated_at = '2000-01-01T00:00:00Z' WHERE home_id = $1 AND id = 'ST020'`,
      [homeAId]
    );
    const before = await pool.query(
      `SELECT updated_at FROM staff WHERE home_id = $1 AND id = 'ST020'`,
      [homeAId]
    );

    await request(app)
      .delete('/api/staff/ST020')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Verify soft-deleted in DB
    const { rows } = await pool.query(
      `SELECT deleted_at, active, updated_at FROM staff WHERE home_id = $1 AND id = 'ST020'`,
      [homeAId]
    );
    expect(rows[0].deleted_at).not.toBeNull();
    expect(rows[0].active).toBe(false);
    expect(rows[0].updated_at.toISOString()).not.toBe(before.rows[0].updated_at.toISOString());
  });

  it('cascades override deletion', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count FROM shift_overrides WHERE home_id = $1 AND staff_id = 'ST020'`,
      [homeAId]
    );
    expect(parseInt(rows[0].count)).toBe(0);
  });

  it('returns 404 for nonexistent staff', async () => {
    await request(app)
      .delete('/api/staff/NONEXISTENT')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('viewer cannot delete staff', async () => {
    await request(app)
      .delete('/api/staff/ST020')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
  });
});

// ── PII Filtering ───────────────────────────────────────────────────────────

describe('GET /api/scheduling — PII filtering', () => {
  beforeAll(async () => {
    // Seed staff with PII fields
    await pool.query(
      `INSERT INTO staff (home_id, id, name, role, team, skill, hourly_rate, active, date_of_birth, ni_number, version)
       VALUES ($1, 'ST030', 'PII Target', 'Carer', 'Day A', 2, 14.00, true, '1985-07-20', 'CD654321B', 1)`,
      [homeAId]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM staff WHERE home_id = $1 AND id = 'ST030'`, [homeAId]);
  });

  it('admin sees all fields including PII', async () => {
    const res = await request(app)
      .get('/api/scheduling')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const staff = res.body.staff.find(s => s.id === 'ST030');
    expect(staff).toBeDefined();
    expect(staff.hourly_rate).toBe(14);
    // date_of_birth is present (exact value may shift by timezone — check it's a date string)
    expect(staff.date_of_birth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(staff.ni_number).toBe('CD654321B');
  });

  it('viewer does NOT see PII fields', async () => {
    const res = await request(app)
      .get('/api/scheduling')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    const staff = res.body.staff.find(s => s.id === 'ST030');
    expect(staff).toBeDefined();
    expect(staff.name).toBe('PII Target');
    // PII fields should be absent
    expect(staff.hourly_rate).toBeUndefined();
    expect(staff.date_of_birth).toBeUndefined();
    expect(staff.ni_number).toBeUndefined();
  });

  it('viewer does NOT see onboarding data', async () => {
    const res = await request(app)
      .get('/api/scheduling')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    expect(res.body.onboarding).toBeUndefined();
  });
});

// ── Cross-Home Isolation ────────────────────────────────────────────────────

describe('Cross-home isolation', () => {
  beforeAll(async () => {
    // Seed staff in home B
    await pool.query(
      `INSERT INTO staff (home_id, id, name, role, team, skill, hourly_rate, active, version)
       VALUES ($1, 'ST040', 'Home B Staff', 'Carer', 'Day A', 1, 13.00, true, 1)`,
      [homeBId]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM staff WHERE home_id = $1 AND id = 'ST040'`, [homeBId]);
  });

  it('admin can create staff in home B', async () => {
    const staff = makeStaff({ id: 'ST041', name: 'Home B New' });
    const res = await request(app)
      .post('/api/staff')
      .query({ home: homeBSlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send(staff)
      .expect(201);

    expect(res.body.id).toBe('ST041');

    // Clean up
    await pool.query(`DELETE FROM staff WHERE home_id = $1 AND id = 'ST041'`, [homeBId]);
  });

  it('viewer cannot access home B staff via scheduling', async () => {
    await request(app)
      .get('/api/scheduling')
      .query({ home: homeBSlug })
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
  });

  it('viewer cannot create staff in home B', async () => {
    const staff = makeStaff({ id: 'ST042' });
    await request(app)
      .post('/api/staff')
      .query({ home: homeBSlug })
      .set('Authorization', `Bearer ${viewerToken}`)
      .send(staff)
      .expect(403);
  });

  it('home A staff not visible in home B scheduling response', async () => {
    // Ensure home A has staff
    await pool.query(
      `INSERT INTO staff (home_id, id, name, role, team, skill, hourly_rate, active, version)
       VALUES ($1, 'ST043', 'Home A Only', 'Carer', 'Day B', 1, 13.00, true, 1)
       ON CONFLICT (home_id, id) DO NOTHING`,
      [homeAId]
    );

    const res = await request(app)
      .get('/api/scheduling')
      .query({ home: homeBSlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const ids = res.body.staff.map(s => s.id);
    expect(ids).not.toContain('ST043');

    await pool.query(`DELETE FROM staff WHERE home_id = $1 AND id = 'ST043'`, [homeAId]);
  });

  it('same staff ID can exist in different homes', async () => {
    // Create ST099 in both homes
    const staff = makeStaff({ id: 'ST099', name: 'Shared ID Home A' });
    await request(app)
      .post('/api/staff')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send(staff)
      .expect(201);

    const staffB = makeStaff({ id: 'ST099', name: 'Shared ID Home B' });
    await request(app)
      .post('/api/staff')
      .query({ home: homeBSlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .send(staffB)
      .expect(201);

    // Verify each home sees its own version
    const resA = await request(app)
      .get('/api/scheduling')
      .query({ home: homeASlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const resB = await request(app)
      .get('/api/scheduling')
      .query({ home: homeBSlug })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const staffA = resA.body.staff.find(s => s.id === 'ST099');
    const staffBResult = resB.body.staff.find(s => s.id === 'ST099');
    expect(staffA.name).toBe('Shared ID Home A');
    expect(staffBResult.name).toBe('Shared ID Home B');

    // Clean up
    await pool.query(`DELETE FROM staff WHERE id = 'ST099' AND home_id IN ($1, $2)`, [homeAId, homeBId]);
  });
});
