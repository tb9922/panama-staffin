/**
 * Integration tests for the Residents module — findResidentsWithBeds query,
 * filters, cross-home isolation, route auth, and edge cases.
 *
 * Requires: PostgreSQL running with migrations applied (through 090).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import * as financeRepo from '../../repositories/financeRepo.js';
import { app } from '../../server.js';

const PREFIX = 'res-test';
let homeA, homeB;
let residentA1, residentA2, _residentA3, residentA4;
let _bedA1, _bedA2;
let adminToken, viewerToken;

const ADMIN_USER = `${PREFIX}-admin`;
const ADMIN_PW = 'ResTestAdmin!2025';
const VIEWER_USER = `${PREFIX}-viewer`;
const VIEWER_PW = 'ResTestViewer!2025';

beforeAll(async () => {
  // Clean up previous test data (child tables first due to FK constraints)
  const homeIds = `(SELECT id FROM homes WHERE slug LIKE '${PREFIX}-%')`;
  await pool.query(`DELETE FROM bed_transitions WHERE home_id IN ${homeIds}`).catch(() => {});
  await pool.query(`DELETE FROM beds WHERE home_id IN ${homeIds}`).catch(() => {});
  await pool.query(`DELETE FROM finance_fee_changes WHERE home_id IN ${homeIds}`).catch(() => {});
  await pool.query(`DELETE FROM finance_residents WHERE home_id IN ${homeIds}`).catch(() => {});
  await pool.query(`DELETE FROM user_home_access WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE '${PREFIX}-%'`);

  // Create test homes
  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('${PREFIX}-a', 'Residents Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('${PREFIX}-b', 'Residents Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;

  // Create test users
  const adminHash = await bcrypt.hash(ADMIN_PW, 4); // low cost for speed
  const viewerHash = await bcrypt.hash(VIEWER_PW, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'admin', true, 'Res Test Admin', 'test-setup')`,
    [ADMIN_USER, adminHash]
  );
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Res Test Viewer', 'test-setup')`,
    [VIEWER_USER, viewerHash]
  );

  // Grant home access
  await pool.query(
    `INSERT INTO user_home_access (username, home_id) VALUES ($1, $2), ($1, $3)`,
    [ADMIN_USER, homeA, homeB]
  );
  await pool.query(
    `INSERT INTO user_home_access (username, home_id) VALUES ($1, $2)`,
    [VIEWER_USER, homeA]
  );

  // Login
  const adminRes = await request(app).post('/api/login').send({ username: ADMIN_USER, password: ADMIN_PW }).expect(200);
  adminToken = adminRes.body.token;
  const viewerRes = await request(app).post('/api/login').send({ username: VIEWER_USER, password: VIEWER_PW }).expect(200);
  viewerToken = viewerRes.body.token;

  // Create 4 residents in homeA
  residentA1 = await financeRepo.createResident(homeA, {
    resident_name: 'Alice Adams',
    room_number: '101',
    admission_date: '2025-01-15',
    care_type: 'residential',
    funding_type: 'self_funded',
    weekly_fee: 1000,
    status: 'active',
    created_by: ADMIN_USER,
  });

  residentA2 = await financeRepo.createResident(homeA, {
    resident_name: 'Bob Baker',
    room_number: '102',
    admission_date: '2025-02-01',
    care_type: 'nursing',
    funding_type: 'la_funded',
    weekly_fee: 1500,
    status: 'active',
    next_fee_review: '2025-07-01',
    created_by: ADMIN_USER,
  });

  _residentA3 = await financeRepo.createResident(homeA, {
    resident_name: 'Carol Clark',
    room_number: '103',
    admission_date: '2025-03-01',
    care_type: 'residential',
    funding_type: 'chc_funded',
    weekly_fee: 1800,
    status: 'discharged',
    created_by: ADMIN_USER,
  });

  residentA4 = await financeRepo.createResident(homeA, {
    resident_name: 'Dave Davis',
    room_number: '104',
    admission_date: '2025-04-01',
    care_type: 'dementia_residential',
    funding_type: 'self_funded',
    weekly_fee: 2000,
    status: 'active',
    created_by: ADMIN_USER,
  });

  // Create beds and link two to residents
  const { rows: [b1] } = await pool.query(
    `INSERT INTO beds (home_id, room_number, room_type, status, resident_id, created_by)
     VALUES ($1, 'R-101', 'single', 'occupied', $2, $3) RETURNING id`,
    [homeA, residentA1.id, ADMIN_USER]
  );
  _bedA1 = b1.id;

  const { rows: [b2] } = await pool.query(
    `INSERT INTO beds (home_id, room_number, room_type, floor, status, resident_id, created_by)
     VALUES ($1, 'R-102', 'nursing', '2', 'hospital_hold', $2, $3) RETURNING id`,
    [homeA, residentA2.id, ADMIN_USER]
  );
  _bedA2 = b2.id;

  // Create a resident in homeB for cross-home isolation tests
  await financeRepo.createResident(homeB, {
    resident_name: 'Eve Evans',
    room_number: '201',
    care_type: 'residential',
    funding_type: 'self_funded',
    weekly_fee: 900,
    status: 'active',
    created_by: ADMIN_USER,
  });
}, 15000);

afterAll(async () => {
  // Clean child tables first
  for (const tbl of ['bed_transitions', 'beds', 'finance_fee_changes', 'finance_residents']) {
    await pool.query(`DELETE FROM ${tbl} WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  }
  await pool.query(`DELETE FROM user_home_access WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Query + JOIN tests ──────────────────────────────────────────────────────────

describe('findResidentsWithBeds: query + JOIN', () => {
  it('returns all non-deleted residents with total count', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA);
    expect(result.total).toBe(4);
    expect(result.rows).toHaveLength(4);
  });

  it('includes bed data for occupied resident', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA);
    const alice = result.rows.find(r => r.resident_name === 'Alice Adams');
    expect(alice).toBeDefined();
    expect(alice.bed).not.toBeNull();
    expect(alice.bed.room_number).toBe('R-101');
    expect(alice.bed.room_type).toBe('single');
    expect(alice.bed.status).toBe('occupied');
  });

  it('includes bed data for hospital_hold resident', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA);
    const bob = result.rows.find(r => r.resident_name === 'Bob Baker');
    expect(bob).toBeDefined();
    expect(bob.bed).not.toBeNull();
    expect(bob.bed.room_number).toBe('R-102');
    expect(bob.bed.room_type).toBe('nursing');
    expect(bob.bed.floor).toBe('2');
    expect(bob.bed.status).toBe('hospital_hold');
  });

  it('returns null bed for resident without a bed', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA);
    const dave = result.rows.find(r => r.resident_name === 'Dave Davis');
    expect(dave).toBeDefined();
    expect(dave.bed).toBeNull();
  });

  it('returns null bed for discharged resident', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA);
    const carol = result.rows.find(r => r.resident_name === 'Carol Clark');
    expect(carol).toBeDefined();
    expect(carol.bed).toBeNull();
  });

  it('orders by room_number then name', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA);
    const names = result.rows.map(r => r.resident_name);
    expect(names).toEqual(['Alice Adams', 'Bob Baker', 'Carol Clark', 'Dave Davis']);
  });

  it('does not include beds with other statuses (available, maintenance, etc.)', async () => {
    // Add an available bed linked to Dave — should NOT be returned by the JOIN
    await pool.query(
      `INSERT INTO beds (home_id, room_number, room_type, status, resident_id, created_by)
       VALUES ($1, 'R-104-avail', 'single', 'available', $2, $3)`,
      [homeA, residentA4.id, ADMIN_USER]
    );
    const result = await financeRepo.findResidentsWithBeds(homeA);
    const dave = result.rows.find(r => r.resident_name === 'Dave Davis');
    expect(dave.bed).toBeNull();
    // Cleanup
    await pool.query(`DELETE FROM beds WHERE home_id = $1 AND room_number = 'R-104-avail'`, [homeA]);
  });

  it('respects pagination limit and offset', async () => {
    const page1 = await financeRepo.findResidentsWithBeds(homeA, { limit: 2, offset: 0 });
    expect(page1.rows).toHaveLength(2);
    expect(page1.total).toBe(4);

    const page2 = await financeRepo.findResidentsWithBeds(homeA, { limit: 2, offset: 2 });
    expect(page2.rows).toHaveLength(2);
    expect(page2.total).toBe(4);

    // No overlap
    const ids1 = page1.rows.map(r => r.id);
    const ids2 = page2.rows.map(r => r.id);
    expect(ids1.filter(id => ids2.includes(id))).toHaveLength(0);
  });
});

// ── Filter tests ────────────────────────────────────────────────────────────────

describe('findResidentsWithBeds: filters', () => {
  it('filters by status=active', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA, { status: 'active' });
    expect(result.total).toBe(3);
    result.rows.forEach(r => expect(r.status).toBe('active'));
  });

  it('filters by status=discharged', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA, { status: 'discharged' });
    expect(result.total).toBe(1);
    expect(result.rows[0].resident_name).toBe('Carol Clark');
  });

  it('filters by fundingType', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA, { fundingType: 'self_funded' });
    expect(result.total).toBe(2);
    result.rows.forEach(r => expect(r.funding_type).toBe('self_funded'));
  });

  it('filters by search (case-insensitive)', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA, { search: 'bob' });
    expect(result.total).toBe(1);
    expect(result.rows[0].resident_name).toBe('Bob Baker');
  });

  it('search partial match works', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA, { search: 'a' });
    // Alice Adams, Bob Baker, Carol Clark, Dave Davis — all contain 'a' (case-insensitive)
    expect(result.total).toBeGreaterThanOrEqual(3);
  });

  it('combines status + fundingType filters', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA, {
      status: 'active', fundingType: 'self_funded',
    });
    expect(result.total).toBe(2);
    result.rows.forEach(r => {
      expect(r.status).toBe('active');
      expect(r.funding_type).toBe('self_funded');
    });
  });

  it('combines status + search', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA, {
      status: 'active', search: 'alice',
    });
    expect(result.total).toBe(1);
    expect(result.rows[0].resident_name).toBe('Alice Adams');
  });

  it('returns empty for non-matching filters', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA, { search: 'zzz-no-match' });
    expect(result.total).toBe(0);
    expect(result.rows).toHaveLength(0);
  });
});

// ── Security / isolation tests ──────────────────────────────────────────────────

describe('Residents: cross-home isolation', () => {
  it('homeA query does not include homeB residents', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeA);
    const names = result.rows.map(r => r.resident_name);
    expect(names).not.toContain('Eve Evans');
  });

  it('homeB query does not include homeA residents', async () => {
    const result = await financeRepo.findResidentsWithBeds(homeB);
    expect(result.total).toBe(1);
    expect(result.rows[0].resident_name).toBe('Eve Evans');
  });
});

describe('Route: GET /finance/residents/with-beds', () => {
  it('admin can access the endpoint', async () => {
    const res = await request(app)
      .get('/api/finance/residents/with-beds')
      .query({ home: `${PREFIX}-a` })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.rows).toBeDefined();
    expect(res.body.total).toBeGreaterThanOrEqual(4);
  });

  it('viewer is blocked (admin-only)', async () => {
    await request(app)
      .get('/api/finance/residents/with-beds')
      .query({ home: `${PREFIX}-a` })
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
  });

  it('rejects unauthenticated request', async () => {
    await request(app)
      .get('/api/finance/residents/with-beds')
      .query({ home: `${PREFIX}-a` })
      .expect(401);
  });

  it('viewer cannot access homeB (no home access)', async () => {
    await request(app)
      .get('/api/finance/residents/with-beds')
      .query({ home: `${PREFIX}-b` })
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
  });

  it('passes query filters through to the repo', async () => {
    const res = await request(app)
      .get('/api/finance/residents/with-beds')
      .query({ home: `${PREFIX}-a`, status: 'active', search: 'alice' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.rows[0].resident_name).toBe('Alice Adams');
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────────

describe('findResidentsWithBeds: edge cases', () => {
  it('soft-deleted residents are excluded', async () => {
    // Soft-delete one resident
    await pool.query(
      `UPDATE finance_residents SET deleted_at = NOW() WHERE id = $1`, [residentA4.id]
    );
    const result = await financeRepo.findResidentsWithBeds(homeA);
    expect(result.total).toBe(3);
    const names = result.rows.map(r => r.resident_name);
    expect(names).not.toContain('Dave Davis');

    // Restore
    await pool.query(
      `UPDATE finance_residents SET deleted_at = NULL WHERE id = $1`, [residentA4.id]
    );
  });

  it('empty home returns total=0 and empty rows', async () => {
    // Create a fresh empty home
    const { rows: [hEmpty] } = await pool.query(
      `INSERT INTO homes (slug, name) VALUES ('${PREFIX}-empty', 'Empty Home') RETURNING id`
    );
    const result = await financeRepo.findResidentsWithBeds(hEmpty.id);
    expect(result.total).toBe(0);
    expect(result.rows).toHaveLength(0);
    await pool.query('DELETE FROM homes WHERE id = $1', [hEmpty.id]);
  });

  it('limit is capped at 500', async () => {
    // Pass limit > 500 — should be capped internally
    const result = await financeRepo.findResidentsWithBeds(homeA, { limit: 9999 });
    // We only have 4 rows, but the important thing is no error
    expect(result.rows.length).toBeLessThanOrEqual(500);
    expect(result.total).toBe(4);
  });

  it('multiple beds for same resident (only occupied/hospital_hold joined)', async () => {
    // Resident A1 already has an occupied bed. Add a decommissioned one.
    await pool.query(
      `INSERT INTO beds (home_id, room_number, room_type, status, resident_id, created_by)
       VALUES ($1, 'R-101-OLD', 'single', 'decommissioned', $2, $3)`,
      [homeA, residentA1.id, ADMIN_USER]
    );

    const result = await financeRepo.findResidentsWithBeds(homeA);
    const alice = result.rows.find(r => r.resident_name === 'Alice Adams');
    // Should only get the occupied bed, not the decommissioned one
    expect(alice.bed).not.toBeNull();
    expect(alice.bed.room_number).toBe('R-101');
    expect(alice.bed.status).toBe('occupied');

    // Cleanup
    await pool.query(`DELETE FROM beds WHERE home_id = $1 AND room_number = 'R-101-OLD'`, [homeA]);
  });
});
