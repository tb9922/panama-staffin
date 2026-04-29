/**
 * Integration tests for staff CSV import routes.
 *
 * Covers: template download, dry-run validation, live import,
 * duplicate detection, admin-only enforcement, Zod validation.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';
import { config } from '../../config.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

const PREFIX = 'import-test';
const ADMIN_USER = `${PREFIX}-admin`;
const VIEWER_USER = `${PREFIX}-viewer`;
const ADMIN_PW = 'ImportTestAdmin!2025';
const VIEWER_PW = 'ImportTestViewer!2025';
const BASE = '/api/import';

let adminToken, viewerToken;
let homeAId, homeBId;
let homeASlug, homeBSlug;

const VALID_CSV = [
  'name,role,team,pref,skill,hourly_rate,start_date,contract_hours,wtr_opt_out',
  'Alice Nurse,Senior Carer,Day A,E,2,18.50,2025-01-15,37.5,false',
  'Bob Porter,Carer,Day B,L,1,14.00,2025-02-01,37.5,false',
].join('\n');

const INVALID_CSV = [
  'name,role,team,pref,skill,hourly_rate,start_date,contract_hours,wtr_opt_out',
  ',Senior Carer,Day A,E,2,18.50,2025-01-15,37.5,false',         // empty name
  'Charlie,InvalidRole,Day A,E,1,14.00,2025-02-01,37.5,false',   // invalid role
].join('\n');

const MISSING_HEADERS_CSV = [
  'name,role,team',
  'Alice,Senior Carer,Day A',
].join('\n');

const DUPLICATE_CSV = [
  'name,role,team,pref,skill,hourly_rate,start_date,contract_hours,wtr_opt_out',
  'Dupe Staff,Carer,Day A,E,1,14.00,2025-03-01,37.5,false',
  'Dupe Staff,Carer,Day B,L,1,15.00,2025-03-01,37.5,false',
].join('\n');

// ── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanup() {
  const { rows } = await pool.query(
    `SELECT id FROM homes WHERE slug LIKE '${PREFIX}-%'`
  );
  const homeIds = rows.map(r => r.id);

  for (const hid of homeIds) {
    await pool.query(`DELETE FROM import_log WHERE home_id = $1`, [hid]).catch(() => {});
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

  homeASlug = `${PREFIX}-home-a`;
  homeBSlug = `${PREFIX}-home-b`;
  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, $2, '{}') RETURNING id`,
    [homeASlug, 'Import Test Home A']
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, $2, '{}') RETURNING id`,
    [homeBSlug, 'Import Test Home B']
  );
  homeAId = ha.id;
  homeBId = hb.id;

  const adminHash = await bcrypt.hash(ADMIN_PW, 4);
  const viewerHash = await bcrypt.hash(VIEWER_PW, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'admin', true, 'Import Test Admin', 'test-setup')`,
    [ADMIN_USER, adminHash]
  );
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Import Test Viewer', 'test-setup')`,
    [VIEWER_USER, viewerHash]
  );

  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by) VALUES ($1, $2, 'home_manager', 'test-setup'), ($1, $3, 'home_manager', 'test-setup')`,
    [ADMIN_USER, homeAId, homeBId]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by) VALUES ($1, $2, 'viewer', 'test-setup')`,
    [VIEWER_USER, homeAId]
  );

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
}, 15000);

afterAll(async () => {
  await cleanup();
});

// ── 1. Template Download ─────────────────────────────────────────────────────

describe('Template Download — GET /staff/template', () => {
  it('returns CSV with correct headers', async () => {
    const res = await request(app)
      .get(`${BASE}/staff/template?home=${homeASlug}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/staff_import_template\.csv/);
    const body = res.text.trim();
    expect(body).toBe('name,role,team,pref,skill,hourly_rate,start_date,contract_hours,wtr_opt_out');
  });

  it('viewer can download template (scheduling:read)', async () => {
    await request(app)
      .get(`${BASE}/staff/template?home=${homeASlug}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
  });

  it('requires auth (no token → 401)', async () => {
    await request(app)
      .get(`${BASE}/staff/template?home=${homeASlug}`)
      .expect(401);
  });
});

// ── 2. Dry Run Validation ────────────────────────────────────────────────────

describe('Dry Run — POST /staff?dryRun=true', () => {
  it('validates correct CSV and returns valid count', async () => {
    const res = await request(app)
      .post(`${BASE}/staff?home=${homeASlug}&dryRun=true`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(VALID_CSV), 'staff.csv')
      .expect(200);

    expect(res.body.dryRun).toBe(true);
    expect(res.body.valid).toBe(2);
    expect(res.body.errors).toHaveLength(0);
    expect(res.body.total).toBe(2);
  });

  it('reports validation errors for invalid CSV', async () => {
    const res = await request(app)
      .post(`${BASE}/staff?home=${homeASlug}&dryRun=true`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(INVALID_CSV), 'staff.csv')
      .expect(200);

    expect(res.body.dryRun).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
    // Both rows should have errors
    expect(res.body.valid).toBeLessThan(res.body.total);
  });

  it('rejects missing CSV columns', async () => {
    const res = await request(app)
      .post(`${BASE}/staff?home=${homeASlug}&dryRun=true`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(MISSING_HEADERS_CSV), 'staff.csv')
      .expect(400);

    expect(res.body.error).toMatch(/Missing CSV columns/);
  });

  it('rejects non-CSV file', async () => {
    const res = await request(app)
      .post(`${BASE}/staff?home=${homeASlug}&dryRun=true`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('hello world'), 'staff.txt')
      .expect(400);

    expect(res.body.error).toMatch(/CSV/);
  });

  it('rejects request with no file', async () => {
    const res = await request(app)
      .post(`${BASE}/staff?home=${homeASlug}&dryRun=true`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(res.body.error).toMatch(/No file/);
  });

  it('rejects the import when the upload malware scanner rejects it', async () => {
    const originalUploadConfig = { ...config.upload };
    try {
      config.upload.scanCommand = process.execPath;
      config.upload.scanArgs = ['-e', 'process.exit(1)'];
      config.upload.scanTimeoutMs = 5000;

      const res = await request(app)
        .post(`${BASE}/staff?home=${homeASlug}&dryRun=true`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', Buffer.from(VALID_CSV), 'staff.csv')
        .expect(400);

      expect(res.body.error).toMatch(/malware scan/i);
    } finally {
      Object.assign(config.upload, originalUploadConfig);
    }
  });

  it('defaults to dry run when dryRun param omitted', async () => {
    const res = await request(app)
      .post(`${BASE}/staff?home=${homeASlug}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(VALID_CSV), 'staff.csv')
      .expect(200);

    expect(res.body.dryRun).toBe(true);
  });
});

// ── 3. Live Import ───────────────────────────────────────────────────────────

describe('Live Import — POST /staff?dryRun=false', () => {
  it('imports valid CSV and creates staff records', async () => {
    const res = await request(app)
      .post(`${BASE}/staff?home=${homeASlug}&dryRun=false`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(VALID_CSV), 'staff.csv')
      .expect(201);

    expect(res.body.imported).toBe(2);
    expect(res.body.filename).toBe('staff.csv');

    // Verify staff were actually created in the DB
    const { rows } = await pool.query(
      `SELECT name FROM staff WHERE home_id = $1 AND name IN ('Alice Nurse', 'Bob Porter')`,
      [homeAId]
    );
    expect(rows.length).toBe(2);
  });

  it('rejects live import with validation errors', async () => {
    await request(app)
      .post(`${BASE}/staff?home=${homeASlug}&dryRun=false`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(INVALID_CSV), 'staff.csv')
      .expect(400);
  });

  it('detects duplicates in CSV batch', async () => {
    await request(app)
      .post(`${BASE}/staff?home=${homeASlug}&dryRun=false`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(DUPLICATE_CSV), 'staff.csv')
      .expect(400);
  });

  it('detects duplicates against existing DB staff (409)', async () => {
    // Alice Nurse was already imported above — re-importing should fail
    const res = await request(app)
      .post(`${BASE}/staff?home=${homeASlug}&dryRun=false`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(VALID_CSV), 'staff.csv')
      .expect(409);

    expect(res.body.error).toMatch(/already exist/);
    expect(res.body.duplicates.length).toBeGreaterThan(0);
  });

  it('import is home-scoped (same staff in different home succeeds)', async () => {
    const res = await request(app)
      .post(`${BASE}/staff?home=${homeBSlug}&dryRun=false`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(VALID_CSV), 'staff.csv')
      .expect(201);

    expect(res.body.imported).toBe(2);
  });

  it('creates an import log entry', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM import_log WHERE home_id = $1 ORDER BY imported_at DESC LIMIT 1`,
      [homeAId]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].import_type).toBe('staff');
    expect(rows[0].row_count).toBe(2);
    expect(rows[0].imported_by).toBe(ADMIN_USER);
  });
});

// ── 4. Auth & RBAC ──────────────────────────────────────────────────────────

describe('Auth & RBAC', () => {
  it('viewer cannot import (403)', async () => {
    await request(app)
      .post(`${BASE}/staff?home=${homeASlug}&dryRun=true`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .attach('file', Buffer.from(VALID_CSV), 'staff.csv')
      .expect(403);
  });

  it('no auth returns 401', async () => {
    await request(app)
      .post(`${BASE}/staff?home=${homeASlug}&dryRun=true`)
      .attach('file', Buffer.from(VALID_CSV), 'staff.csv')
      .expect(401);
  });

  it('viewer can download template (scheduling:read)', async () => {
    await request(app)
      .get(`${BASE}/staff/template?home=${homeASlug}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
  });
});

// ── 5. Edge Cases ────────────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('handles BOM-prefixed CSV', async () => {
    const bomCsv = '\uFEFF' + VALID_CSV.replace('Alice Nurse', 'BOM Alice').replace('Bob Porter', 'BOM Bob');
    // Use home B since home A already has Alice/Bob
    // Clean home B first
    await pool.query(`DELETE FROM staff WHERE home_id = $1 AND name LIKE 'BOM%'`, [homeBId]).catch(() => {});
    await pool.query(`DELETE FROM staff WHERE home_id = $1 AND name IN ('Alice Nurse', 'Bob Porter')`, [homeBId]).catch(() => {});

    const res = await request(app)
      .post(`${BASE}/staff?home=${homeBSlug}&dryRun=false`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(bomCsv), 'staff.csv')
      .expect(201);

    expect(res.body.imported).toBe(2);
  });

  it('handles quoted CSV fields', async () => {
    const quotedCsv = [
      'name,role,team,pref,skill,hourly_rate,start_date,contract_hours,wtr_opt_out',
      '"Smith, Jane",Senior Carer,Day A,E,2,18.50,2025-04-01,37.5,false',
    ].join('\n');

    const res = await request(app)
      .post(`${BASE}/staff?home=${homeASlug}&dryRun=true`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(quotedCsv), 'staff.csv')
      .expect(200);

    expect(res.body.valid).toBe(1);
    expect(res.body.errors).toHaveLength(0);
  });
});
