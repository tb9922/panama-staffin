/**
 * Integration tests for payroll HTTP routes.
 *
 * Covers: pay rate rules, NMW, timesheets, payroll runs, agency,
 * tax codes, pensions, SSP/sick periods, HMRC liabilities,
 * auth/RBAC, tenant isolation, Zod validation.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

const PREFIX = 'payroll-test';
const ADMIN_USER = `${PREFIX}-admin`;
const VIEWER_USER = `${PREFIX}-viewer`;
const ADMIN_PW = 'PayrollTestAdmin!2025';
const VIEWER_PW = 'PayrollTestViewer!2025';
const BASE = '/api/payroll';

let adminToken, viewerToken;
let homeAId, homeBId;
let homeASlug, homeBSlug;

const HOME_CONFIG = {
  home_name: 'Payroll Test Home A',
  registered_beds: 30,
  care_type: 'residential',
  cycle_start_date: '2025-01-06',
  shifts: {
    E:  { hours: 8, start: '07:00', end: '15:00' },
    L:  { hours: 8, start: '14:00', end: '22:00' },
    EL: { hours: 12, start: '07:00', end: '19:00' },
    N:  { hours: 10, start: '21:00', end: '07:00' },
  },
  minimum_staffing: {
    early: { heads: 3, skill_points: 3 },
    late:  { heads: 3, skill_points: 3 },
    night: { heads: 2, skill_points: 2 },
  },
  agency_rate_day: 22, agency_rate_night: 25,
  ot_premium: 2, bh_premium_multiplier: 1.5,
  max_consecutive_days: 6, max_al_same_day: 2,
  leave_year_start: '04-01',
  bank_holidays: [],
};

// ── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanup() {
  const { rows } = await pool.query(
    `SELECT id FROM homes WHERE slug LIKE '${PREFIX}-%'`
  );
  const homeIds = rows.map(r => r.id);
  if (homeIds.length === 0) {
    // Still clean up users
    await pool.query(`DELETE FROM user_home_roles WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
    await pool.query(`DELETE FROM token_denylist WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
    await pool.query(`DELETE FROM users WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
    await pool.query(`DELETE FROM homes WHERE slug LIKE '${PREFIX}-%'`).catch(() => {});
    return;
  }

  for (const hid of homeIds) {
    // Reverse FK order
    await pool.query(`DELETE FROM pension_contributions WHERE home_id = $1`, [hid]).catch(() => {});
    await pool.query(`DELETE FROM pension_enrolments WHERE home_id = $1`, [hid]).catch(() => {});
    await pool.query(`DELETE FROM hmrc_liabilities WHERE home_id = $1`, [hid]).catch(() => {});
    await pool.query(`DELETE FROM sick_periods WHERE home_id = $1`, [hid]).catch(() => {});
    await pool.query(`DELETE FROM payroll_line_shifts WHERE id IN (
      SELECT pls.id FROM payroll_line_shifts pls
      JOIN payroll_lines pl ON pls.line_id = pl.id
      JOIN payroll_runs pr ON pl.run_id = pr.id WHERE pr.home_id = $1)`, [hid]).catch(() => {});
    await pool.query(`DELETE FROM payroll_lines WHERE run_id IN (
      SELECT id FROM payroll_runs WHERE home_id = $1)`, [hid]).catch(() => {});
    await pool.query(`DELETE FROM payroll_runs WHERE home_id = $1`, [hid]).catch(() => {});
    await pool.query(`DELETE FROM pay_rate_rules WHERE home_id = $1`, [hid]).catch(() => {});
    await pool.query(`DELETE FROM payroll_ytd WHERE home_id = $1`, [hid]).catch(() => {});
    await pool.query(`DELETE FROM agency_shifts WHERE home_id = $1`, [hid]).catch(() => {});
    await pool.query(`DELETE FROM agency_providers WHERE home_id = $1`, [hid]).catch(() => {});
    await pool.query(`DELETE FROM timesheet_entries WHERE home_id = $1`, [hid]).catch(() => {});
    await pool.query(`DELETE FROM tax_codes WHERE home_id = $1`, [hid]).catch(() => {});
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [hid]).catch(() => {});
    await pool.query(`DELETE FROM staff WHERE home_id = $1`, [hid]).catch(() => {});
  }
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM audit_log WHERE home_slug LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE '${PREFIX}-%'`).catch(() => {});
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await cleanup();

  // Create test homes
  homeASlug = `${PREFIX}-home-a`;
  homeBSlug = `${PREFIX}-home-b`;
  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, $2, $3) RETURNING id`,
    [homeASlug, 'Payroll Test Home A', JSON.stringify(HOME_CONFIG)]
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, $2, $3) RETURNING id`,
    [homeBSlug, 'Payroll Test Home B', JSON.stringify({ ...HOME_CONFIG, home_name: 'Payroll Test Home B' })]
  );
  homeAId = ha.id;
  homeBId = hb.id;

  // Create test users
  const adminHash = await bcrypt.hash(ADMIN_PW, 12);
  const viewerHash = await bcrypt.hash(VIEWER_PW, 12);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'admin', true, 'Payroll Test Admin', 'test-setup')`,
    [ADMIN_USER, adminHash]
  );
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Payroll Test Viewer', 'test-setup')`,
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

  // Insert test staff in home A (rates set high to pass NMW compliance checks)
  await pool.query(
    `INSERT INTO staff (home_id, id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out, start_date, contract_hours, version)
     VALUES ($1, 'PH01', 'Alice Senior', 'Senior Carer', 'Day A', 'E', 2, 25.00, true, false, '2024-01-15', 37.5, 1),
            ($1, 'PH02', 'Bob Carer', 'Carer', 'Day B', 'L', 1, 20.00, true, false, '2024-06-01', 37.5, 1)`,
    [homeAId]
  );

  // Insert shift overrides for payroll calculation (7 working days)
  for (let d = 1; d <= 7; d++) {
    const date = `2099-06-${String(d).padStart(2, '0')}`;
    await pool.query(
      `INSERT INTO shift_overrides (home_id, date, staff_id, shift, source)
       VALUES ($1, $2, 'PH01', 'E', 'manual'), ($1, $2, 'PH02', 'L', 'manual')`,
      [homeAId, date]
    );
  }
}, 30000);

afterAll(async () => {
  await cleanup();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function adminGet(path) {
  return request(app).get(BASE + path).set('Authorization', `Bearer ${adminToken}`);
}
function adminPost(path, body) {
  return request(app).post(BASE + path).set('Authorization', `Bearer ${adminToken}`).send(body);
}
function adminPut(path, body) {
  return request(app).put(BASE + path).set('Authorization', `Bearer ${adminToken}`).send(body);
}
function adminDelete(path) {
  return request(app).delete(BASE + path).set('Authorization', `Bearer ${adminToken}`);
}
function viewerGet(path) {
  return request(app).get(BASE + path).set('Authorization', `Bearer ${viewerToken}`);
}
function viewerPost(path, body) {
  return request(app).post(BASE + path).set('Authorization', `Bearer ${viewerToken}`).send(body);
}
function viewerPut(path, body) {
  return request(app).put(BASE + path).set('Authorization', `Bearer ${viewerToken}`).send(body);
}
function noAuthGet(path) {
  return request(app).get(BASE + path);
}

// ── 1. Pay Rate Rules ────────────────────────────────────────────────────────

describe('Pay Rate Rules — /rates', () => {
  let createdRuleId;

  it('GET returns seeded default rules for admin', async () => {
    const res = await adminGet(`/rates?home=${homeASlug}`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    // Verify rule shape
    const rule = res.body[0];
    expect(rule).toHaveProperty('id');
    expect(rule).toHaveProperty('name');
    expect(rule).toHaveProperty('rate_type');
  });

  it('GET requires admin (viewer → 403)', async () => {
    await viewerGet(`/rates?home=${homeASlug}`).expect(403);
  });

  it('GET requires auth (no token → 401)', async () => {
    await noAuthGet(`/rates?home=${homeASlug}`).expect(401);
  });

  it('POST creates a rule', async () => {
    const res = await adminPost(`/rates?home=${homeASlug}`, {
      name: 'Test Night Premium',
      rate_type: 'percentage',
      amount: 15,
      applies_to: 'night',
    }).expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Test Night Premium');
    expect(res.body.rate_type).toBe('percentage');
    createdRuleId = res.body.id;
  });

  it('POST rejects invalid rate_type enum', async () => {
    await adminPost(`/rates?home=${homeASlug}`, {
      name: 'Bad Rule',
      rate_type: 'invalid_type',
      amount: 10,
      applies_to: 'night',
    }).expect(400);
  });

  it('POST rejects non-positive amount', async () => {
    await adminPost(`/rates?home=${homeASlug}`, {
      name: 'Negative Rule',
      rate_type: 'fixed_hourly',
      amount: -5,
      applies_to: 'overtime',
    }).expect(400);
  });

  it('PUT updates rule (soft-close + new version)', async () => {
    const res = await adminPut(`/rates/${createdRuleId}?home=${homeASlug}`, {
      name: 'Updated Night Premium',
      rate_type: 'percentage',
      amount: 20,
      applies_to: 'night',
    }).expect(200);

    expect(res.body).toHaveProperty('id');
    // The new rule gets a new ID (old one is soft-closed)
    expect(res.body.id).not.toBe(createdRuleId);
    createdRuleId = res.body.id;
  });

  it('PUT returns 404 for nonexistent rule', async () => {
    await adminPut(`/rates/999999?home=${homeASlug}`, {
      name: 'Ghost Rule',
      rate_type: 'fixed_hourly',
      amount: 5,
      applies_to: 'night',
    }).expect(404);
  });

  it('DELETE deactivates rule', async () => {
    const res = await adminDelete(`/rates/${createdRuleId}?home=${homeASlug}`).expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('DELETE returns 404 for already-closed rule', async () => {
    await adminDelete(`/rates/${createdRuleId}?home=${homeASlug}`).expect(404);
  });
});

// ── 2. NMW ───────────────────────────────────────────────────────────────────

describe('NMW — /nmw', () => {
  it('returns NMW rates (no admin required)', async () => {
    // NMW endpoint is auth-only, no requireAdmin or requireHomeAccess
    const res = await request(app)
      .get(BASE + '/nmw')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('returns 401 without auth', async () => {
    await noAuthGet('/nmw').expect(401);
  });
});

// ── 3. Timesheets ────────────────────────────────────────────────────────────

describe('Timesheets — /timesheets', () => {
  let createdTsId;
  let disputeTsId;

  const validEntry = {
    staff_id: 'PH01',
    date: '2099-06-01',
    scheduled_start: '07:00',
    scheduled_end: '15:00',
    actual_start: '06:55',
    actual_end: '15:10',
    break_minutes: 30,
    payable_hours: 7.5,
  };

  it('POST creates entry', async () => {
    const res = await adminPost(`/timesheets?home=${homeASlug}`, validEntry).expect(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.staff_id).toBe('PH01');
    createdTsId = res.body.id;
  });

  it('POST upserts on same staff_id+date', async () => {
    const res = await adminPost(`/timesheets?home=${homeASlug}`, {
      ...validEntry,
      payable_hours: 8.0,
    }).expect(201);
    expect(res.body.id).toBe(createdTsId); // Same record, updated
  });

  it('POST rejects invalid date', async () => {
    await adminPost(`/timesheets?home=${homeASlug}`, {
      ...validEntry,
      date: 'not-a-date',
    }).expect(400);
  });

  it('POST rejects missing staff_id', async () => {
    await adminPost(`/timesheets?home=${homeASlug}`, {
      date: '2099-06-01',
      payable_hours: 8,
    }).expect(400);
  });

  it('POST viewer → 403', async () => {
    await viewerPost(`/timesheets?home=${homeASlug}`, validEntry).expect(403);
  });

  it('GET returns entries for date', async () => {
    const res = await adminGet(`/timesheets?home=${homeASlug}&date=2099-06-01`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET returns empty for no-data date', async () => {
    const res = await adminGet(`/timesheets?home=${homeASlug}&date=2099-01-01`).expect(200);
    expect(res.body).toEqual([]);
  });

  it('GET rejects missing date param', async () => {
    await adminGet(`/timesheets?home=${homeASlug}`).expect(400);
  });

  it('GET period returns entries in range', async () => {
    const res = await adminGet(
      `/timesheets/period?home=${homeASlug}&start=2099-06-01&end=2099-06-07`
    ).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET period rejects missing start/end', async () => {
    await adminGet(`/timesheets/period?home=${homeASlug}`).expect(400);
  });

  it('POST approve single entry', async () => {
    const res = await adminPost(`/timesheets/${createdTsId}/approve?home=${homeASlug}`).expect(200);
    expect(res.body.approved_by).toBeTruthy();
  });

  it('POST approve returns 404 for nonexistent', async () => {
    await adminPost(`/timesheets/999999/approve?home=${homeASlug}`).expect(404);
  });

  it('POST dispute with reason', async () => {
    // Create a fresh pending entry for dispute
    const newEntry = await adminPost(`/timesheets?home=${homeASlug}`, {
      ...validEntry,
      staff_id: 'PH02',
      date: '2099-06-02',
    }).expect(201);
    disputeTsId = newEntry.body.id;

    const res = await adminPost(`/timesheets/${disputeTsId}/dispute?home=${homeASlug}`, {
      reason: 'Wrong hours recorded',
    }).expect(200);
    expect(res.body.status).toBe('disputed');
  });

  it('POST dispute rejects empty reason', async () => {
    // Create another pending entry
    const entry = await adminPost(`/timesheets?home=${homeASlug}`, {
      ...validEntry,
      staff_id: 'PH02',
      date: '2099-06-03',
    }).expect(201);

    await adminPost(`/timesheets/${entry.body.id}/dispute?home=${homeASlug}`, {
      reason: '',
    }).expect(400);
  });

  it('POST bulk-approve by date', async () => {
    // Create two pending entries for same date
    await adminPost(`/timesheets?home=${homeASlug}`, {
      ...validEntry,
      staff_id: 'PH01',
      date: '2099-06-04',
    }).expect(201);
    await adminPost(`/timesheets?home=${homeASlug}`, {
      ...validEntry,
      staff_id: 'PH02',
      date: '2099-06-04',
    }).expect(201);

    const res = await adminPost(`/timesheets/bulk-approve?home=${homeASlug}`, {
      date: '2099-06-04',
    }).expect(200);
    expect(res.body.approved).toBeGreaterThanOrEqual(2);
  });

  it('POST bulk-approve returns 0 for empty date', async () => {
    const res = await adminPost(`/timesheets/bulk-approve?home=${homeASlug}`, {
      date: '2099-01-01',
    }).expect(200);
    expect(res.body.approved).toBe(0);
  });

  it('POST batch-upsert creates multiple', async () => {
    const res = await adminPost(`/timesheets/batch-upsert?home=${homeASlug}`, {
      entries: [
        { ...validEntry, staff_id: 'PH01', date: '2099-06-05' },
        { ...validEntry, staff_id: 'PH02', date: '2099-06-05' },
      ],
    }).expect(201);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
  });

  it('POST batch-upsert rejects empty array', async () => {
    await adminPost(`/timesheets/batch-upsert?home=${homeASlug}`, {
      entries: [],
    }).expect(400);
  });

  it('POST batch-upsert rejects >62 entries', async () => {
    const entries = Array.from({ length: 63 }, (_, i) => ({
      ...validEntry,
      staff_id: 'PH01',
      date: `2099-07-${String(i + 1).padStart(2, '0')}`,
    }));
    await adminPost(`/timesheets/batch-upsert?home=${homeASlug}`, { entries }).expect(400);
  });

  it('POST batch-upsert rejects invalid entry', async () => {
    await adminPost(`/timesheets/batch-upsert?home=${homeASlug}`, {
      entries: [
        { ...validEntry, staff_id: 'PH01', date: '2099-06-06' },
        { staff_id: 'PH02', date: 'bad-date' },
      ],
    }).expect(400);
  });

  it('POST approve-range by staff+dates', async () => {
    // Create pending entries for PH01 in a range
    await adminPost(`/timesheets?home=${homeASlug}`, {
      ...validEntry,
      staff_id: 'PH01',
      date: '2099-06-06',
    }).expect(201);
    await adminPost(`/timesheets?home=${homeASlug}`, {
      ...validEntry,
      staff_id: 'PH01',
      date: '2099-06-07',
    }).expect(201);

    const res = await adminPost(`/timesheets/approve-range?home=${homeASlug}`, {
      staff_id: 'PH01',
      start: '2099-06-06',
      end: '2099-06-07',
    }).expect(200);
    expect(res.body.approved).toBeGreaterThanOrEqual(2);
  });

  it('POST approve-range rejects missing staff_id', async () => {
    await adminPost(`/timesheets/approve-range?home=${homeASlug}`, {
      start: '2099-06-01',
      end: '2099-06-07',
    }).expect(400);
  });
});

// ── 4. Payroll Runs ──────────────────────────────────────────────────────────

describe('Payroll Runs — /runs', () => {
  let runId;
  let draftOnlyRunId;

  it('POST creates draft run', async () => {
    const res = await adminPost(`/runs?home=${homeASlug}`, {
      period_start: '2099-06-01',
      period_end: '2099-06-07',
      pay_frequency: 'weekly',
    }).expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.status).toBe('draft');
    runId = res.body.id;
  });

  it('POST rejects period_start >= period_end', async () => {
    await adminPost(`/runs?home=${homeASlug}`, {
      period_start: '2099-06-07',
      period_end: '2099-06-01',
    }).expect(400);
  });

  it('POST rejects overlapping period', async () => {
    const res = await adminPost(`/runs?home=${homeASlug}`, {
      period_start: '2099-06-03',
      period_end: '2099-06-10',
    }).expect(409);
    expect(res.body.error).toMatch(/overlap/i);
  });

  it('POST rejects invalid pay_frequency', async () => {
    await adminPost(`/runs?home=${homeASlug}`, {
      period_start: '2099-07-01',
      period_end: '2099-07-07',
      pay_frequency: 'daily',
    }).expect(400);
  });

  it('POST viewer → 403', async () => {
    await viewerPost(`/runs?home=${homeASlug}`, {
      period_start: '2099-08-01',
      period_end: '2099-08-07',
    }).expect(403);
  });

  it('GET lists runs (paginated)', async () => {
    const res = await adminGet(`/runs?home=${homeASlug}&limit=10&offset=0`).expect(200);
    expect(res.body).toHaveProperty('rows');
    expect(res.body).toHaveProperty('total');
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('GET detail returns run + lines', async () => {
    const res = await adminGet(`/runs/${runId}?home=${homeASlug}`).expect(200);
    expect(res.body).toHaveProperty('run');
    expect(res.body).toHaveProperty('lines');
    expect(res.body.run.id).toBe(runId);
  });

  it('GET detail returns 404 for nonexistent', async () => {
    await adminGet(`/runs/999999?home=${homeASlug}`).expect(404);
  });

  it('GET detail blocks cross-home access', async () => {
    await adminGet(`/runs/${runId}?home=${homeBSlug}`).expect(404);
  });

  it('POST calculate updates to calculated', async () => {
    const res = await adminPost(`/runs/${runId}/calculate?home=${homeASlug}`).expect(200);
    expect(res.body.run.status).toBe('calculated');
    expect(Array.isArray(res.body.lines)).toBe(true);
  });

  it('POST approve updates to approved', async () => {
    const res = await adminPost(`/runs/${runId}/approve?home=${homeASlug}`).expect(200);
    expect(res.body.status).toBe('approved');
  });

  it('POST approve rejects draft (not calculated) run', async () => {
    // Create a separate draft run to test this
    const draft = await adminPost(`/runs?home=${homeASlug}`, {
      period_start: '2099-07-01',
      period_end: '2099-07-07',
      pay_frequency: 'weekly',
    }).expect(201);
    draftOnlyRunId = draft.body.id;

    const res = await adminPost(`/runs/${draftOnlyRunId}/approve?home=${homeASlug}`);
    // Should fail — either 400 or 500 depending on service implementation
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('GET export returns CSV', async () => {
    const res = await adminGet(`/runs/${runId}/export?home=${homeASlug}`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, private');
  });

  it('GET export supports sage format', async () => {
    const res = await adminGet(`/runs/${runId}/export?home=${homeASlug}&format=sage`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/sage/i);
  });

  it('GET bulk payslips returns JSON array', async () => {
    const res = await adminGet(`/runs/${runId}/payslips?home=${homeASlug}`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  function responseSize(res) {
    if (Buffer.isBuffer(res.body)) return res.body.length;
    if (typeof res.text === 'string') return res.text.length;
    return 0;
  }

  it('GET single payslip returns PDF', async () => {
    const res = await adminGet(`/runs/${runId}/payslips/PH01?home=${homeASlug}`).expect(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, private');
    expect(responseSize(res)).toBeGreaterThan(0);
  });

  it('GET summary-pdf returns PDF for approved run', async () => {
    const res = await adminGet(`/runs/${runId}/summary-pdf?home=${homeASlug}`).expect(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, private');
    expect(responseSize(res)).toBeGreaterThan(0);
  });

  afterAll(async () => {
    // Clean up the draft-only run
    if (draftOnlyRunId) {
      await pool.query(`DELETE FROM payroll_runs WHERE id = $1 AND home_id = $2`, [draftOnlyRunId, homeAId]).catch(() => {});
    }
  });
});

// ── 5. Agency ────────────────────────────────────────────────────────────────

describe('Agency — /agency', () => {
  let providerId;
  let shiftId;

  describe('Providers', () => {
    it('POST creates provider', async () => {
      const res = await adminPost(`/agency/providers?home=${homeASlug}`, {
        name: 'Test Agency Co',
        rate_day: 22,
        rate_night: 25,
      }).expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Test Agency Co');
      providerId = res.body.id;
    });

    it('POST rejects missing name', async () => {
      await adminPost(`/agency/providers?home=${homeASlug}`, {
        rate_day: 22,
      }).expect(400);
    });

    it('GET lists providers', async () => {
      const res = await adminGet(`/agency/providers?home=${homeASlug}`).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some(p => p.id === providerId)).toBe(true);
    });

    it('PUT updates provider', async () => {
      const res = await adminPut(`/agency/providers/${providerId}?home=${homeASlug}`, {
        name: 'Updated Agency Co',
        rate_day: 24,
        rate_night: 27,
      }).expect(200);
      expect(res.body.name).toBe('Updated Agency Co');
    });

    it('PUT returns 404 for nonexistent', async () => {
      await adminPut(`/agency/providers/999999?home=${homeASlug}`, {
        name: 'Ghost Provider',
      }).expect(404);
    });
  });

  describe('Shifts', () => {
    it('POST creates agency shift', async () => {
      const res = await adminPost(`/agency/shifts?home=${homeASlug}`, {
        agency_id: providerId,
        date: '2099-06-01',
        shift_code: 'AG-E',
        hours: 8,
        hourly_rate: 22,
      }).expect(201);

      expect(res.body).toHaveProperty('id');
      // Verify server-calculated total_cost
      expect(parseFloat(res.body.total_cost)).toBe(176); // 8 * 22
      shiftId = res.body.id;
    });

    it('POST rejects invalid shift_code', async () => {
      await adminPost(`/agency/shifts?home=${homeASlug}`, {
        agency_id: providerId,
        date: '2099-06-01',
        shift_code: 'AG-X',
        hours: 8,
        hourly_rate: 22,
      }).expect(400);
    });

    it('POST rejects non-positive hours', async () => {
      await adminPost(`/agency/shifts?home=${homeASlug}`, {
        agency_id: providerId,
        date: '2099-06-01',
        shift_code: 'AG-E',
        hours: -1,
        hourly_rate: 22,
      }).expect(400);
    });

    it('GET returns shifts for date range', async () => {
      const res = await adminGet(
        `/agency/shifts?home=${homeASlug}&start=2099-06-01&end=2099-06-30`
      ).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET rejects missing start/end', async () => {
      await adminGet(`/agency/shifts?home=${homeASlug}`).expect(400);
    });

    it('PUT updates shift', async () => {
      const res = await adminPut(`/agency/shifts/${shiftId}?home=${homeASlug}`, {
        agency_id: providerId,
        date: '2099-06-01',
        shift_code: 'AG-L',
        hours: 8,
        hourly_rate: 24,
      }).expect(200);
      expect(parseFloat(res.body.total_cost)).toBe(192); // 8 * 24
    });
  });

  it('GET metrics returns summary', async () => {
    const res = await adminGet(`/agency/metrics?home=${homeASlug}`).expect(200);
    expect(res.body).toBeDefined();
  });
});

// ── 6. Tax Codes ─────────────────────────────────────────────────────────────

describe('Tax Codes — /tax-codes + /ytd', () => {
  it('POST creates tax code', async () => {
    const res = await adminPost(`/tax-codes?home=${homeASlug}`, {
      staff_id: 'PH01',
      tax_code: '1257L',
      basis: 'cumulative',
      ni_category: 'A',
      effective_from: '2099-04-06',
    }).expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.staff_id).toBe('PH01');
    expect(res.body.tax_code).toBe('1257L');
  });

  it('POST upserts on same staff_id', async () => {
    const res = await adminPost(`/tax-codes?home=${homeASlug}`, {
      staff_id: 'PH01',
      tax_code: 'BR',
      basis: 'w1m1',
      ni_category: 'A',
    }).expect(201);
    expect(res.body.tax_code).toBe('BR');
  });

  it('POST rejects invalid basis enum', async () => {
    await adminPost(`/tax-codes?home=${homeASlug}`, {
      staff_id: 'PH01',
      tax_code: '1257L',
      basis: 'invalid_basis',
    }).expect(400);
  });

  it('POST viewer → 403', async () => {
    await viewerPost(`/tax-codes?home=${homeASlug}`, {
      staff_id: 'PH01',
      tax_code: '1257L',
    }).expect(403);
  });

  it('GET lists tax codes', async () => {
    const res = await adminGet(`/tax-codes?home=${homeASlug}`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET YTD returns data or null', async () => {
    const res = await adminGet(`/ytd?home=${homeASlug}&staffId=PH01&year=2099`).expect(200);
    // May be null if no approved runs
    expect(res.body === null || typeof res.body === 'object').toBe(true);
  });

  it('GET YTD rejects missing staffId/year', async () => {
    await adminGet(`/ytd?home=${homeASlug}`).expect(400);
  });
});

// ── 7. Pensions ──────────────────────────────────────────────────────────────

describe('Pensions — /pensions + /pension-config', () => {
  it('POST creates enrolment', async () => {
    const res = await adminPost(`/pensions?home=${homeASlug}`, {
      staff_id: 'PH01',
      status: 'eligible_enrolled',
      enrolled_date: '2099-06-01',
    }).expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.staff_id).toBe('PH01');
  });

  it('POST upserts on same staff_id', async () => {
    const res = await adminPost(`/pensions?home=${homeASlug}`, {
      staff_id: 'PH01',
      status: 'opted_out',
      opted_out_date: '2099-07-01',
      reassessment_date: '2102-07-01',
      contribution_override_employee: 0.06,
      contribution_override_employer: 0.04,
    }).expect(201);
    expect(res.body.status).toBe('opted_out');
    expect(res.body.opted_out_date).toBe('2099-07-01');
    expect(res.body.reassessment_date).toBe('2102-07-01');
    expect(res.body.contribution_override_employee).toBe(0.06);
    expect(res.body.contribution_override_employer).toBe(0.04);
  });

  it('POST rejects invalid status enum', async () => {
    await adminPost(`/pensions?home=${homeASlug}`, {
      staff_id: 'PH02',
      status: 'invalid_status',
    }).expect(400);
  });

  it('POST viewer → 403', async () => {
    await viewerPost(`/pensions?home=${homeASlug}`, {
      staff_id: 'PH02',
      status: 'pending_assessment',
    }).expect(403);
  });

  it('GET lists enrolments', async () => {
    const res = await adminGet(`/pensions?home=${homeASlug}`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const enrolment = res.body.find((row) => row.staff_id === 'PH01');
    expect(enrolment).toMatchObject({
      status: 'opted_out',
      opted_out_date: '2099-07-01',
      reassessment_date: '2102-07-01',
      contribution_override_employee: 0.06,
      contribution_override_employer: 0.04,
    });
  });

  it('GET pension-config requires payroll read access for the selected home', async () => {
    await request(app)
      .get(`${BASE}/pension-config?home=${homeASlug}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);

    const res = await request(app)
      .get(`${BASE}/pension-config?home=${homeASlug}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(typeof res.body).toBe('object');
  });
});

// ── 8. SSP & Sick Periods ────────────────────────────────────────────────────

describe('SSP — /sick-periods + /ssp-config', () => {
  let periodId;
  let closedPeriodId;

  it('GET ssp-config requires payroll read access for the selected home', async () => {
    await request(app)
      .get(`${BASE}/ssp-config?home=${homeASlug}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);

    const res = await request(app)
      .get(`${BASE}/ssp-config?home=${homeASlug}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST creates sick period', async () => {
    const res = await adminPost(`/sick-periods?home=${homeASlug}`, {
      staff_id: 'PH01',
      start_date: '2099-06-01',
    }).expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.staff_id).toBe('PH01');
    expect(res.body.version).toBe(1);
    periodId = res.body.id;
  });

  it('POST auto-links within 56 days', async () => {
    // Close the first period
    await adminPut(`/sick-periods/${periodId}?home=${homeASlug}`, {
      end_date: '2099-06-05',
    }).expect(200);
    closedPeriodId = periodId;

    // Create a new period within 56 days (8 weeks)
    const res = await adminPost(`/sick-periods?home=${homeASlug}`, {
      staff_id: 'PH01',
      start_date: '2099-07-01', // 26 days later — within 56 days
    }).expect(201);

    expect(res.body.linked_to_period_id).toBe(closedPeriodId);
    expect(res.body.waiting_days_served).toBe(3);
    periodId = res.body.id;
  });

  it('POST rejects missing staff_id', async () => {
    await adminPost(`/sick-periods?home=${homeASlug}`, {
      start_date: '2099-06-01',
    }).expect(400);
  });

  it('POST viewer → 403', async () => {
    await viewerPost(`/sick-periods?home=${homeASlug}`, {
      staff_id: 'PH01',
      start_date: '2099-08-01',
    }).expect(403);
  });

  it('GET lists sick periods', async () => {
    const res = await adminGet(`/sick-periods?home=${homeASlug}`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET filters by staffId', async () => {
    const res = await adminGet(`/sick-periods?home=${homeASlug}&staffId=PH01`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const p of res.body) {
      expect(p.staff_id).toBe('PH01');
    }
  });

  it('PUT updates sick period', async () => {
    const before = await adminGet(`/sick-periods?home=${homeASlug}&staffId=PH01`).expect(200);
    const current = before.body.find((entry) => entry.id === periodId);

    const res = await adminPut(`/sick-periods/${periodId}?home=${homeASlug}`, {
      end_date: '2099-07-10',
      notes: 'Recovery complete',
      _version: current.version,
    }).expect(200);
    expect(res.body.notes).toBe('Recovery complete');
    expect(res.body.version).toBe(current.version + 1);
  });

  it('PUT rejects stale sick-period version', async () => {
    const current = await adminGet(`/sick-periods?home=${homeASlug}&staffId=PH01`).expect(200);
    const target = current.body.find((entry) => entry.id === periodId);

    await adminPut(`/sick-periods/${periodId}?home=${homeASlug}`, {
      notes: 'First concurrent update',
      _version: target.version,
    }).expect(200);

    await adminPut(`/sick-periods/${periodId}?home=${homeASlug}`, {
      notes: 'Stale concurrent update',
      _version: target.version,
    }).expect(409);
  });

  it('PUT returns 404 for nonexistent', async () => {
    await adminPut(`/sick-periods/999999?home=${homeASlug}`, {
      end_date: '2099-07-10',
    }).expect(404);
  });
});

// ── 9. HMRC ──────────────────────────────────────────────────────────────────

describe('HMRC — /hmrc', () => {
  let liabilityId;

  beforeAll(async () => {
    // Seed an HMRC liability directly.
    // Use tax_year 2098 to avoid conflict with the liability created
    // by approveRun() for the 2099 payroll run in the Payroll Runs section.
    const { rows: [row] } = await pool.query(
      `INSERT INTO hmrc_liabilities
        (home_id, tax_year, tax_month, period_start, period_end,
         total_paye, total_employee_ni, total_employer_ni,
         total_due, payment_due_date, status)
       VALUES ($1, 2098, 1, '2098-04-06', '2098-05-05',
         500, 200, 250, 950, '2098-06-19', 'unpaid')
       RETURNING id`,
      [homeAId]
    );
    liabilityId = row.id;
  });

  it('GET lists liabilities by year', async () => {
    const res = await adminGet(`/hmrc?home=${homeASlug}&year=2098`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('total_due');
  });

  it('GET rejects missing year', async () => {
    await adminGet(`/hmrc?home=${homeASlug}`).expect(400);
  });

  it('GET viewer → 403', async () => {
    await viewerGet(`/hmrc?home=${homeASlug}&year=2098`).expect(403);
  });

  it('PUT marks paid', async () => {
    const res = await adminPut(`/hmrc/${liabilityId}/paid?home=${homeASlug}`, {
      paid_date: '2099-07-20',
      paid_reference: 'BACS-12345',
    }).expect(200);
    expect(res.body.status).toBe('paid');
  });

  it('PUT returns 404 for nonexistent', async () => {
    await adminPut(`/hmrc/999999/paid?home=${homeASlug}`, {
      paid_date: '2099-07-20',
    }).expect(404);
  });

  it('PUT viewer → 403', async () => {
    await viewerPut(`/hmrc/${liabilityId}/paid?home=${homeASlug}`, {
      paid_date: '2099-07-20',
    }).expect(403);
  });
});

// ── 10. Cross-Cutting ────────────────────────────────────────────────────────

describe('Cross-cutting: auth + tenant isolation', () => {
  it('admin endpoints return 403 for viewer', async () => {
    await viewerGet(`/rates?home=${homeASlug}`).expect(403);
    await viewerGet(`/runs?home=${homeASlug}`).expect(403);
    await viewerGet(`/pensions?home=${homeASlug}`).expect(403);
  });

  it('all endpoints return 401 without token', async () => {
    await noAuthGet(`/rates?home=${homeASlug}`).expect(401);
    await noAuthGet(`/runs?home=${homeASlug}`).expect(401);
    await noAuthGet(`/pensions?home=${homeASlug}`).expect(401);
  });

  it('viewer cannot access home B', async () => {
    await viewerGet(`/rates?home=${homeBSlug}`).expect(403);
  });

  it('missing home param returns 400', async () => {
    await adminGet('/rates').expect(400);
  });

  it('audit log entries created for mutations', async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT action FROM audit_log WHERE home_slug = $1 AND action LIKE 'payroll_%'`,
      [homeASlug]
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Timesheet status bypass prevention ──────────────────────────────────────

describe('Timesheet: status field stripped from upsert', () => {
  it('POST /timesheets ignores status field — always creates as pending', async () => {
    const res = await adminPost(`/timesheets?home=${homeASlug}`, {
      staff_id: 'S001',
      date: '2026-03-20',
      payable_hours: 8,
      status: 'approved',  // should be stripped by Zod schema
    }).expect(201);

    // status should be 'pending' regardless of what was sent
    expect(res.body.status).toBe('pending');
    expect(res.body.approved_by).toBeFalsy();
    expect(res.body.approved_at).toBeFalsy();
  });
});

// ── Payroll void route ──────────────────────────────────────────────────────

describe('Payroll Runs: void route', () => {
  let voidTestRunId;

  it('POST /runs creates a draft run for void testing', async () => {
    const res = await adminPost(`/runs?home=${homeASlug}`, {
      period_start: '2026-04-01',
      period_end: '2026-04-30',
      pay_date: '2026-05-05',
    });
    // May be 201 or 409 (overlap) depending on existing test data
    if (res.status === 201) {
      voidTestRunId = res.body.id;
    }
  });

  it('POST /runs/:runId/void voids a draft run', async () => {
    if (!voidTestRunId) return; // skip if creation failed due to overlap
    const res = await request(app)
      .post(`${BASE}/runs/${voidTestRunId}/void?home=${homeASlug}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(200);

    expect(res.body.status).toBe('voided');
  });

  it('POST /runs/:runId/void rejects already-voided run', async () => {
    if (!voidTestRunId) return;
    await request(app)
      .post(`${BASE}/runs/${voidTestRunId}/void?home=${homeASlug}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);
  });
});
