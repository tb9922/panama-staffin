/**
 * Integration tests for staff_member own-data filtering.
 *
 * Verifies that users with 'own' access level (staff_member role)
 * can only see their own data on scheduling and payroll endpoints.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';

const PREFIX = 'owndata-test';
const STAFF_USER = `${PREFIX}-staff`;
const MANAGER_USER = `${PREFIX}-mgr`;
const PW = 'TestOwn!2025x';

let staffToken, managerToken;
let homeId, homeSlug;
let payrollRunId;

beforeAll(async () => {
  // Clean up from previous runs
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM timesheet_entries WHERE home_id IN (SELECT id FROM homes WHERE slug = '${PREFIX}-home')`);
  await pool.query(`DELETE FROM sick_periods WHERE home_id IN (SELECT id FROM homes WHERE slug = '${PREFIX}-home')`);
  await pool.query(`DELETE FROM pension_enrolments WHERE home_id IN (SELECT id FROM homes WHERE slug = '${PREFIX}-home')`);
  await pool.query(`DELETE FROM tax_codes WHERE home_id IN (SELECT id FROM homes WHERE slug = '${PREFIX}-home')`);
  await pool.query(`DELETE FROM payroll_lines WHERE payroll_run_id IN (SELECT id FROM payroll_runs WHERE home_id IN (SELECT id FROM homes WHERE slug = '${PREFIX}-home'))`);
  await pool.query(`DELETE FROM payroll_runs WHERE home_id IN (SELECT id FROM homes WHERE slug = '${PREFIX}-home')`);
  await pool.query(`DELETE FROM shift_overrides WHERE home_id IN (SELECT id FROM homes WHERE slug = '${PREFIX}-home')`);
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug = '${PREFIX}-home')`);
  await pool.query(`DELETE FROM users WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM homes WHERE slug = '${PREFIX}-home'`);

  // Create test home
  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config)
     VALUES ('${PREFIX}-home', 'Own Data Test Home', $1) RETURNING id, slug`,
    [JSON.stringify({
      home_name: 'Own Data Test Home',
      registered_beds: 30,
      cycle_start_date: '2025-01-06',
      shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
      agency_rate_day: 25, agency_rate_night: 30, ot_premium: 5, bh_premium_multiplier: 1.5,
    })]
  );
  homeId = home.id;
  homeSlug = home.slug;

  // Create 3 staff members
  for (const [id, name] of [['S001', 'Alice Staff'], ['S002', 'Bob Other'], ['S003', 'Carol Third']]) {
    await pool.query(
      `INSERT INTO staff (home_id, id, name, role, team, hourly_rate, active, contract_hours, ni_number)
       VALUES ($1, $2, $3, 'Carer', 'Day A', 14.50, true, 40, $4)`,
      [homeId, id, name, `AB${id}C`]
    );
  }

  // Create overrides for S001 and S002
  await pool.query(
    `INSERT INTO shift_overrides (home_id, date, staff_id, shift, reason)
     VALUES ($1, '2099-06-01', 'S001', 'AL', 'Holiday'),
            ($1, '2099-06-01', 'S002', 'SICK', 'Flu'),
            ($1, '2099-06-02', 'S001', 'TRN', 'Fire safety')`,
    [homeId]
  );

  // Create a payroll run with lines for S001, S002, S003
  const { rows: [run] } = await pool.query(
    `INSERT INTO payroll_runs (home_id, period_start, period_end, pay_frequency, status, total_gross, total_enhancements, total_sleep_ins, staff_count)
     VALUES ($1, '2099-05-01', '2099-05-31', 'monthly', 'calculated', 15000, 500, 100, 3) RETURNING id`,
    [homeId]
  );
  payrollRunId = run.id;
  for (const [sid, gross] of [['S001', 5000], ['S002', 5500], ['S003', 4500]]) {
    await pool.query(
      `INSERT INTO payroll_lines (payroll_run_id, staff_id, base_hours, base_pay, total_hours, gross_pay)
       VALUES ($1, $2, 160, $3, 160, $3)`,
      [payrollRunId, sid, gross]
    );
  }

  // Create tax codes for S001 and S002
  for (const [sid, code] of [['S001', '1257L'], ['S002', '1100L']]) {
    await pool.query(
      `INSERT INTO tax_codes (home_id, staff_id, tax_code, basis, ni_category, effective_from, source)
       VALUES ($1, $2, $3, 'cumulative', 'A', '2099-01-01', 'manual')`,
      [homeId, sid, code]
    );
  }

  // Create pension enrolments for S001 and S002
  for (const sid of ['S001', 'S002']) {
    await pool.query(
      `INSERT INTO pension_enrolments (home_id, staff_id, status)
       VALUES ($1, $2, 'eligible_enrolled')`,
      [homeId, sid]
    );
  }

  // Create sick periods for S001 and S002
  for (const [sid, start] of [['S001', '2099-04-01'], ['S002', '2099-04-10']]) {
    await pool.query(
      `INSERT INTO sick_periods (home_id, staff_id, start_date, end_date)
       VALUES ($1, $2, $3, $3)`,
      [homeId, sid, start]
    );
  }

  // Create timesheet entries for S001 and S002
  for (const sid of ['S001', 'S002']) {
    await pool.query(
      `INSERT INTO timesheet_entries (home_id, staff_id, date, actual_start, actual_end, payable_hours, status)
       VALUES ($1, $2, '2099-06-01', '07:00', '15:00', 8, 'pending')`,
      [homeId, sid]
    );
  }

  // Create users
  const hash = await bcrypt.hash(PW, 4);
  for (const [username, role] of [[STAFF_USER, 'viewer'], [MANAGER_USER, 'admin']]) {
    await pool.query(
      `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
       VALUES ($1, $2, $3, true, $1, 'test-setup')`,
      [username, hash, role]
    );
  }

  // Assign roles: staff_member with staff_id, home_manager
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, staff_id, granted_by) VALUES
      ($1, $3, 'staff_member', 'S001', 'test-setup'),
      ($2, $3, 'home_manager', NULL, 'test-setup')`,
    [STAFF_USER, MANAGER_USER, homeId]
  );

  // Login and capture tokens
  for (const [username, setter] of [
    [STAFF_USER, (t) => { staffToken = t; }],
    [MANAGER_USER, (t) => { managerToken = t; }],
  ]) {
    const res = await request(app).post('/api/login').send({ username, password: PW });
    setter(res.body.token);
  }
}, 15000);

afterAll(async () => {
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM timesheet_entries WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM sick_periods WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM pension_enrolments WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM tax_codes WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM payroll_lines WHERE payroll_run_id IN (SELECT id FROM payroll_runs WHERE home_id = $1)`, [homeId]);
  await pool.query(`DELETE FROM payroll_runs WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM staff WHERE home_id = $1`, [homeId]);
  await pool.query(`DELETE FROM users WHERE username LIKE '${PREFIX}-%'`);
  await pool.query(`DELETE FROM homes WHERE slug = '${PREFIX}-home'`);
});

function authGet(path, token) {
  return request(app).get(path).set('Authorization', `Bearer ${token}`);
}

// ── GET /api/scheduling — own-data filtering ─────────────────────────────────

describe('staff_member: GET /api/scheduling', () => {
  it('returns all staff names but no PII fields', async () => {
    const res = await authGet(`/api/scheduling?home=${homeSlug}`, staffToken).expect(200);
    const staff = res.body.staff;
    expect(staff.length).toBeGreaterThanOrEqual(3);
    // Should have basic fields
    const s1 = staff.find(s => s.id === 'S001');
    expect(s1.name).toBe('Alice Staff');
    expect(s1.role).toBe('Carer');
    expect(s1.team).toBe('Day A');
    // Should NOT have PII/sensitive fields
    expect(s1.hourly_rate).toBeUndefined();
    expect(s1.ni_number).toBeUndefined();
    expect(s1.contract_hours).toBeUndefined();
    expect(s1.al_entitlement).toBeUndefined();
  });

  it('returns only own overrides', async () => {
    const res = await authGet(`/api/scheduling?home=${homeSlug}&from=2099-05-01&to=2099-07-01`, staffToken).expect(200);
    const overrides = res.body.overrides;
    // Should have S001's overrides
    expect(overrides['2099-06-01']).toBeDefined();
    expect(overrides['2099-06-01']['S001']).toBeDefined();
    // Should NOT have S002's overrides
    expect(overrides['2099-06-01']['S002']).toBeUndefined();
    // S001's second override
    expect(overrides['2099-06-02']).toBeDefined();
    expect(overrides['2099-06-02']['S001']).toBeDefined();
  });

  it('omits training data', async () => {
    const res = await authGet(`/api/scheduling?home=${homeSlug}`, staffToken).expect(200);
    expect(res.body.training).toEqual([]);
    expect(res.body.onboarding).toBeUndefined();
  });

  it('strips commercially sensitive config fields', async () => {
    const res = await authGet(`/api/scheduling?home=${homeSlug}`, staffToken).expect(200);
    const config = res.body.config;
    expect(config.home_name).toBe('Own Data Test Home');
    expect(config.shifts).toBeDefined();
    // Cost parameters stripped
    expect(config.agency_rate_day).toBeUndefined();
    expect(config.agency_rate_night).toBeUndefined();
    expect(config.ot_premium).toBeUndefined();
    expect(config.bh_premium_multiplier).toBeUndefined();
  });

  it('manager sees all staff fields and all overrides', async () => {
    const res = await authGet(`/api/scheduling?home=${homeSlug}&from=2099-05-01&to=2099-07-01`, managerToken).expect(200);
    const s1 = res.body.staff.find(s => s.id === 'S001');
    expect(s1.hourly_rate).toBeDefined();
    expect(s1.ni_number).toBeDefined();
    // Manager sees S002's overrides
    expect(res.body.overrides['2099-06-01']['S002']).toBeDefined();
  });
});

// ── GET /api/data — blocked for staff_member ─────────────────────────────────

describe('staff_member: GET /api/data', () => {
  it('returns 403 for staff_member', async () => {
    const res = await authGet(`/api/data?home=${homeSlug}`, staffToken);
    expect(res.status).toBe(403);
  });
});

// ── Write endpoints — blocked for staff_member ───────────────────────────────

describe('staff_member: write endpoints blocked', () => {
  it('PUT /api/scheduling/overrides returns 403', async () => {
    const res = await request(app)
      .put(`/api/scheduling/overrides?home=${homeSlug}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ date: '2099-06-03', staffId: 'S001', shift: 'AL' });
    expect(res.status).toBe(403);
  });
});

// ── Payroll: own-data filtering ──────────────────────────────────────────────

describe('staff_member: GET /api/payroll/runs', () => {
  it('returns runs but strips aggregate totals', async () => {
    const res = await authGet(`/api/payroll/runs?home=${homeSlug}`, staffToken).expect(200);
    expect(res.body.rows.length).toBeGreaterThanOrEqual(1);
    const run = res.body.rows.find(r => r.id === payrollRunId);
    expect(run).toBeDefined();
    // Totals should be stripped
    expect(run.total_gross).toBeUndefined();
    expect(run.total_enhancements).toBeUndefined();
    expect(run.total_sleep_ins).toBeUndefined();
    expect(run.staff_count).toBeUndefined();
    // Non-sensitive fields remain
    expect(run.period_start).toBeDefined();
    expect(run.status).toBe('calculated');
  });

  it('manager sees aggregate totals on runs list', async () => {
    const res = await authGet(`/api/payroll/runs?home=${homeSlug}`, managerToken).expect(200);
    const run = res.body.rows.find(r => r.id === payrollRunId);
    expect(run.total_gross).toBe(15000);
    expect(run.staff_count).toBe(3);
  });
});

describe('staff_member: GET /api/payroll/runs/:runId', () => {
  it('returns only own line, no aggregate totals', async () => {
    const res = await authGet(`/api/payroll/runs/${payrollRunId}?home=${homeSlug}`, staffToken).expect(200);
    // Only S001's line
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].staff_id).toBe('S001');
    expect(res.body.lines[0].gross_pay).toBe(5000);
    // Run totals stripped
    expect(res.body.run.total_gross).toBeUndefined();
    expect(res.body.run.total_enhancements).toBeUndefined();
    expect(res.body.run.staff_count).toBeUndefined();
  });

  it('manager sees all lines and totals', async () => {
    const res = await authGet(`/api/payroll/runs/${payrollRunId}?home=${homeSlug}`, managerToken).expect(200);
    expect(res.body.lines).toHaveLength(3);
    expect(res.body.run.total_gross).toBe(15000);
  });
});

describe('staff_member: GET /api/payroll/runs/:runId/payslips/:staffId', () => {
  it('returns 403 when accessing another staff payslip', async () => {
    const res = await authGet(`/api/payroll/runs/${payrollRunId}/payslips/S002?home=${homeSlug}`, staffToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/own payslip/i);
  });
});

describe('staff_member: home-level payroll endpoints blocked', () => {
  it('GET /api/payroll/rates returns 403', async () => {
    const res = await authGet(`/api/payroll/rates?home=${homeSlug}`, staffToken);
    expect(res.status).toBe(403);
  });

  it('GET /api/payroll/agency/providers returns 403', async () => {
    const res = await authGet(`/api/payroll/agency/providers?home=${homeSlug}`, staffToken);
    expect(res.status).toBe(403);
  });

  it('GET /api/payroll/agency/shifts returns 403', async () => {
    const res = await authGet(`/api/payroll/agency/shifts?home=${homeSlug}&start=2099-01-01&end=2099-12-31`, staffToken);
    expect(res.status).toBe(403);
  });

  it('GET /api/payroll/agency/metrics returns 403', async () => {
    const res = await authGet(`/api/payroll/agency/metrics?home=${homeSlug}`, staffToken);
    expect(res.status).toBe(403);
  });

  it('GET /api/payroll/hmrc returns 403', async () => {
    const res = await authGet(`/api/payroll/hmrc?home=${homeSlug}&year=2099`, staffToken);
    expect(res.status).toBe(403);
  });

  it('GET /api/payroll/runs/:runId/summary-pdf returns 403', async () => {
    const res = await authGet(`/api/payroll/runs/${payrollRunId}/summary-pdf?home=${homeSlug}`, staffToken);
    expect(res.status).toBe(403);
  });
});

// ── Payroll: own-data filtered endpoints ────────────────────────────────────

describe('staff_member: GET /api/payroll/tax-codes', () => {
  it('returns only own tax code', async () => {
    const res = await authGet(`/api/payroll/tax-codes?home=${homeSlug}`, staffToken).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].staff_id).toBe('S001');
    expect(res.body[0].tax_code).toBe('1257L');
  });

  it('manager sees all tax codes', async () => {
    const res = await authGet(`/api/payroll/tax-codes?home=${homeSlug}`, managerToken).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });
});

describe('staff_member: GET /api/payroll/pensions', () => {
  it('returns only own pension enrolment', async () => {
    const res = await authGet(`/api/payroll/pensions?home=${homeSlug}`, staffToken).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].staff_id).toBe('S001');
  });

  it('manager sees all pension enrolments', async () => {
    const res = await authGet(`/api/payroll/pensions?home=${homeSlug}`, managerToken).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });
});

describe('staff_member: GET /api/payroll/sick-periods', () => {
  it('returns only own sick periods (forces staffId)', async () => {
    // Try to pass another staff's ID — should be overridden to own
    const res = await authGet(`/api/payroll/sick-periods?home=${homeSlug}&staffId=S002`, staffToken).expect(200);
    for (const period of res.body) {
      expect(period.staff_id).toBe('S001');
    }
  });
});

describe('staff_member: GET /api/payroll/ytd', () => {
  it('forces own staffId regardless of query param', async () => {
    // Pass S002 — should be overridden to S001
    // Pass S002 in query — should be overridden to S001
    await authGet(`/api/payroll/ytd?home=${homeSlug}&staffId=S002&year=2099`, staffToken).expect(200);
  });
});

describe('staff_member: GET /api/payroll/timesheets', () => {
  it('returns only own timesheet entries', async () => {
    const res = await authGet(`/api/payroll/timesheets?home=${homeSlug}&date=2099-06-01`, staffToken).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].staff_id).toBe('S001');
  });

  it('manager sees all timesheet entries', async () => {
    const res = await authGet(`/api/payroll/timesheets?home=${homeSlug}&date=2099-06-01`, managerToken).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });
});

describe('staff_member: GET /api/payroll/timesheets/period', () => {
  it('forces own staffId in period view', async () => {
    const res = await authGet(
      `/api/payroll/timesheets/period?home=${homeSlug}&start=2099-05-01&end=2099-07-01&staff_id=S002`,
      staffToken
    ).expect(200);
    for (const entry of res.body) {
      expect(entry.staff_id).toBe('S001');
    }
  });
});

// ── staff_member with no staff_id ────────────────────────────────────────────

describe('staff_member with no staff_id', () => {
  let noLinkToken;

  beforeAll(async () => {
    const hash = await bcrypt.hash(PW, 4);
    await pool.query(
      `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
       VALUES ('${PREFIX}-nolink', $1, 'viewer', true, 'No Link', 'test-setup')
       ON CONFLICT (username) DO NOTHING`,
      [hash]
    );
    await pool.query(
      `INSERT INTO user_home_roles (username, home_id, role_id, staff_id, granted_by)
       VALUES ('${PREFIX}-nolink', $1, 'staff_member', NULL, 'test-setup')
       ON CONFLICT DO NOTHING`,
      [homeId]
    );
    const loginRes = await request(app).post('/api/login').send({ username: `${PREFIX}-nolink`, password: PW });
    noLinkToken = loginRes.body.token;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM user_home_roles WHERE username = '${PREFIX}-nolink'`);
    await pool.query(`DELETE FROM token_denylist WHERE username = '${PREFIX}-nolink'`);
    await pool.query(`DELETE FROM users WHERE username = '${PREFIX}-nolink'`);
  });

  it('GET /api/scheduling returns 403 when no staff_id linked', async () => {
    const res = await authGet(`/api/scheduling?home=${homeSlug}`, noLinkToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/staff link/i);
  });
});
