import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);

vi.mock('../../lib/ssrf.js', async () => {
  const actual = await vi.importActual('../../lib/ssrf.js');
  return {
    ...actual,
    resolvedToPrivateIp: vi.fn(async () => false),
  };
});

import { pool } from '../../db.js';
import { app } from '../../server.js';
import { __primeBankHolidayCacheForTests, __resetBankHolidayCacheForTests } from '../../routes/bankHolidays.js';

const PREFIX = 'coverage-routes';
const ADMIN_USER = `${PREFIX}-admin`;
const SIGNOFF_USER = `${PREFIX}-signoff`;
const TRAINING_LEAD_USER = `${PREFIX}-training-lead`;
const VIEWER_USER = `${PREFIX}-viewer`;
const PW = 'CoverageTest!2026';

let adminToken;
let signoffToken;
let trainingLeadToken;
let viewerToken;
let homeAId;
let homeASlug;
let homeBSlug;

const HOME_CONFIG = {
  home_name: 'Coverage Test Home',
  registered_beds: 20,
  cycle_start_date: '2025-01-06',
  shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
  minimum_staffing: {
    early: { heads: 2, skill_points: 2 },
    late: { heads: 2, skill_points: 2 },
    night: { heads: 1, skill_points: 1 },
  },
};

function authGet(path, token) {
  return request(app).get(path).set('Authorization', `Bearer ${token}`);
}

function authPost(path, token, body) {
  return request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);
}

function authPut(path, token, body) {
  return request(app).put(path).set('Authorization', `Bearer ${token}`).send(body);
}

function authDelete(path, token, body = undefined) {
  const req = request(app).delete(path).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}

async function cleanup() {
  await pool.query(`DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhooks WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE '${PREFIX}-%'))`).catch(() => {});
  await pool.query(`DELETE FROM webhooks WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE '${PREFIX}-%')`).catch(() => {});
  await pool.query(`DELETE FROM assessment_snapshots WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE '${PREFIX}-%')`).catch(() => {});
  await pool.query(`DELETE FROM audit_log WHERE home_slug LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM shift_overrides WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE '${PREFIX}-%')`).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE '${PREFIX}-%')`).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username LIKE '${PREFIX}-%'`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE '${PREFIX}-%'`).catch(() => {});
}

beforeAll(async () => {
  await cleanup();

  homeASlug = `${PREFIX}-home-a`;
  homeBSlug = `${PREFIX}-home-b`;

  const { rows: [homeA] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, $2, $3) RETURNING id`,
    [homeASlug, 'Coverage Home A', JSON.stringify(HOME_CONFIG)]
  );
  homeAId = homeA.id;

  await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, $2, $3)`,
    [homeBSlug, 'Coverage Home B', JSON.stringify({ ...HOME_CONFIG, home_name: 'Coverage Home B' })]
  );

  await pool.query(
    `INSERT INTO staff (home_id, id, name, role, team, pref, skill, hourly_rate, active, contract_hours)
     VALUES ($1, 'CV001', 'Coverage Admin Staff', 'Senior Carer', 'Day A', 'E', 2, 16.5, true, 37.5)`,
    [homeAId]
  );

  const hash = await bcrypt.hash(PW, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES
       ($1, $4, 'admin', true, 'Coverage Admin', 'test-setup'),
       ($2, $4, 'admin', true, 'Coverage Signoff', 'test-setup'),
       ($3, $4, 'viewer', true, 'Coverage Training Lead', 'test-setup'),
       ($5, $4, 'viewer', true, 'Coverage Viewer', 'test-setup')`,
    [ADMIN_USER, SIGNOFF_USER, TRAINING_LEAD_USER, hash, VIEWER_USER]
  );

  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, staff_id, granted_by)
     VALUES
       ($1, $4, 'home_manager', NULL, 'test-setup'),
       ($2, $4, 'home_manager', NULL, 'test-setup'),
       ($3, $4, 'training_lead', NULL, 'test-setup'),
       ($5, $4, 'viewer', NULL, 'test-setup')`,
    [ADMIN_USER, SIGNOFF_USER, TRAINING_LEAD_USER, homeAId, VIEWER_USER]
  );

  const adminLogin = await request(app).post('/api/login').send({ username: ADMIN_USER, password: PW }).expect(200);
  const signoffLogin = await request(app).post('/api/login').send({ username: SIGNOFF_USER, password: PW }).expect(200);
  const trainingLeadLogin = await request(app).post('/api/login').send({ username: TRAINING_LEAD_USER, password: PW }).expect(200);
  const viewerLogin = await request(app).post('/api/login').send({ username: VIEWER_USER, password: PW }).expect(200);

  adminToken = adminLogin.body.token;
  signoffToken = signoffLogin.body.token;
  trainingLeadToken = trainingLeadLogin.body.token;
  viewerToken = viewerLogin.body.token;
}, 20000);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetBankHolidayCacheForTests();
});

afterAll(async () => {
  await cleanup();
});

describe('webhook routes', () => {
  it('covers CRUD, validation, cross-home isolation, and delivery log access', async () => {
    await authGet(`/api/webhooks?home=${homeASlug}`, viewerToken).expect(403);

    const createRes = await authPost(`/api/webhooks?home=${homeASlug}`, adminToken, {
      url: 'https://example.com/webhook',
      secret: 'super-secret-coverage-key',
      events: ['incident.created'],
      active: true,
    }).expect(201);

    expect(createRes.body.url).toBe('https://example.com/webhook');
    expect(createRes.body.secret).toBeUndefined();
    const webhookId = createRes.body.id;

    await authPost(`/api/webhooks?home=${homeASlug}`, adminToken, {
      url: 'http://example.com/insecure',
      secret: 'super-secret-coverage-key',
      events: ['incident.created'],
      active: true,
    }).expect(400);

    await pool.query(
      `INSERT INTO webhook_deliveries (webhook_id, event, payload, status_code, response_ms, error, status)
       VALUES ($1, 'incident.created', '{}'::jsonb, 200, 32, NULL, 'delivered')`,
      [webhookId]
    );

    const deliveriesRes = await authGet(`/api/webhooks/${webhookId}/deliveries?home=${homeASlug}`, adminToken).expect(200);
    expect(deliveriesRes.body).toHaveLength(1);
    expect(deliveriesRes.body[0].status).toBe('delivered');

    await authGet(`/api/webhooks/${webhookId}/deliveries?home=${homeBSlug}`, adminToken).expect(403);

    await authPut(`/api/webhooks/${webhookId}?home=${homeASlug}`, adminToken, {
      url: 'https://example.com/updated',
      secret: 'super-secret-coverage-key',
      events: ['incident.created', 'override.created'],
      active: false,
    }).expect(200);

    await authDelete(`/api/webhooks/${webhookId}?home=${homeASlug}`, adminToken).expect(200);
    await authGet(`/api/webhooks/${webhookId}/deliveries?home=${homeASlug}`, adminToken).expect(404);
  });
});

describe('audit routes', () => {
  it('covers admin auth, purge permissions, and report-download logging', async () => {
    await pool.query(
      `INSERT INTO audit_log (action, home_slug, user_name, details, ts)
       VALUES
         ('coverage_new', $1, $2, '{"kind":"new"}', NOW()),
         ('coverage_old', $1, $2, '{"kind":"old"}', NOW() - INTERVAL '90 days')`,
      [homeASlug, ADMIN_USER]
    );

    await authGet('/api/audit', viewerToken).expect(403);

    const recentRes = await authGet(`/api/audit?home=${homeASlug}&limit=5`, adminToken).expect(200);
    expect(Array.isArray(recentRes.body)).toBe(true);
    expect(recentRes.body.some((row) => row.action === 'coverage_new')).toBe(true);

    await authGet(`/api/audit?home=${homeBSlug}`, adminToken).expect(403);

    await authDelete(`/api/audit/purge?home=${homeASlug}`, viewerToken, { days: 30 }).expect(403);
    const purgeRes = await authDelete(`/api/audit/purge?home=${homeASlug}`, adminToken, { days: 30 }).expect(200);
    expect(purgeRes.body.deleted).toBeGreaterThanOrEqual(1);

    await authPost(`/api/audit/report-download?home=${homeASlug}`, adminToken, {
      reportType: 'staff',
      dateRange: '2026-Q1',
    }).expect(200);

    const { rows } = await pool.query(
      `SELECT action, details FROM audit_log WHERE home_slug = $1 AND action = 'report_download' ORDER BY ts DESC LIMIT 1`,
      [homeASlug]
    );
    expect(rows[0].action).toBe('report_download');
    expect(rows[0].details).toContain('staff');
  });
});

describe('assessment routes', () => {
  it('covers snapshot create/list/get/sign-off and cross-home access', async () => {
    const createRes = await authPost(`/api/assessment/snapshot?home=${homeASlug}`, adminToken, {
      engine: 'gdpr',
    }).expect(201);

    const snapshotId = createRes.body.id;
    expect(createRes.body.engine).toBe('gdpr');
    expect(createRes.body.overall_score).toBeTypeOf('number');

    const listRes = await authGet(`/api/assessment/snapshots?home=${homeASlug}&engine=gdpr`, adminToken).expect(200);
    expect(listRes.body.some((row) => row.id === snapshotId)).toBe(true);

    const getRes = await authGet(`/api/assessment/snapshots/${snapshotId}?home=${homeASlug}`, adminToken).expect(200);
    expect(getRes.body.id).toBe(snapshotId);

    await authPut(`/api/assessment/snapshots/${snapshotId}/sign-off?home=${homeASlug}`, adminToken, {
      notes: 'self sign-off should fail',
    }).expect(403);

    const signoffRes = await authPut(`/api/assessment/snapshots/${snapshotId}/sign-off?home=${homeASlug}`, signoffToken, {
      notes: 'Reviewed by second manager',
    }).expect(200);
    expect(signoffRes.body.signed_off_by).toBe(SIGNOFF_USER);

    await authGet(`/api/assessment/snapshots/${snapshotId}?home=${homeBSlug}`, adminToken).expect(403);
  });
});

describe('dashboard and export routes', () => {
  it('covers summary auth/shape and export download response', async () => {
    await request(app).get(`/api/dashboard/summary?home=${homeASlug}`).expect(401);

    const summaryRes = await authGet(`/api/dashboard/summary?home=${homeASlug}`, adminToken).expect(200);
    expect(summaryRes.body).toMatchObject({
      modules: expect.any(Object),
      alerts: expect.any(Array),
      weekActions: expect.any(Array),
    });

    const exportRes = await authGet(`/api/export?home=${homeASlug}`, viewerToken).expect(200);
    expect(exportRes.headers['content-type']).toMatch(/application\/json/);
    expect(exportRes.headers['content-disposition']).toMatch(/attachment/);
    expect(exportRes.headers['cache-control']).toBe('no-store, no-cache, must-revalidate, private');
    expect(exportRes.body.staff).toBeDefined();

    await authGet(`/api/export?home=${homeBSlug}`, viewerToken).expect(403);
  });

  it('redacts staff PII for training leads in export and data responses', async () => {
    const exportRes = await authGet(`/api/export?home=${homeASlug}`, trainingLeadToken).expect(200);
    const exportStaff = exportRes.body.staff.find((row) => row.id === 'CV001');
    expect(exportStaff).toBeTruthy();
    expect(exportStaff).not.toHaveProperty('hourly_rate');
    expect(exportStaff).not.toHaveProperty('ni_number');
    expect(exportStaff).not.toHaveProperty('date_of_birth');

    const dataRes = await authGet(`/api/data?home=${homeASlug}`, trainingLeadToken).expect(200);
    const dataStaff = dataRes.body.staff.find((row) => row.id === 'CV001');
    expect(dataStaff).toBeTruthy();
    expect(dataStaff).not.toHaveProperty('hourly_rate');
    expect(dataStaff).not.toHaveProperty('ni_number');
    expect(dataStaff).not.toHaveProperty('date_of_birth');
  });
});

describe('bank holidays route', () => {
  it('covers auth plus region-aware live-fetch and stale-cache fallback behavior', async () => {
    await request(app).get('/api/bank-holidays').expect(401);

    __resetBankHolidayCacheForTests();

    const fetchMock = vi.fn()
      .mockResolvedValue({
        json: async () => ({
          'england-and-wales': {
            events: [{ date: '2026-12-25', title: 'Christmas Day' }],
          },
          scotland: {
            events: [{ date: '2026-11-30', title: "St Andrew's Day" }],
          },
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const freshRes = await authGet('/api/bank-holidays', viewerToken).expect(200);
    expect(freshRes.body).toEqual([{ date: '2026-12-25', name: 'Christmas Day' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const scotlandRes = await authGet('/api/bank-holidays?region=scotland', viewerToken).expect(200);
    expect(scotlandRes.body).toEqual([{ date: '2026-11-30', name: "St Andrew's Day" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    __primeBankHolidayCacheForTests('england-and-wales', freshRes.body, Date.now() - 1);
    fetchMock.mockRejectedValueOnce(new Error('upstream down'));

    const staleRes = await authGet('/api/bank-holidays', viewerToken).expect(200);
    expect(staleRes.body).toEqual([{ date: '2026-12-25', name: 'Christmas Day' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
