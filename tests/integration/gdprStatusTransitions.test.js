import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { pool } from '../../db.js';
import { app } from '../../server.js';

const PREFIX = 'gdpr-status-route';
const USERNAME = `${PREFIX}-manager`;
const PASSWORD = 'GdprStatus1!';

let homeId;
let homeSlug;
let token;

beforeAll(async () => {
  await pool.query(`DELETE FROM dpia_assessments WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]).catch(() => {});
  await pool.query(`DELETE FROM ropa_activities WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]).catch(() => {});
  await pool.query('DELETE FROM user_home_roles WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM token_denylist WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM users WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM homes WHERE slug = $1', [`${PREFIX}-home`]).catch(() => {});

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'GDPR Status Route Home', '{}'::jsonb) RETURNING id, slug`,
    [`${PREFIX}-home`]
  );
  homeId = home.id;
  homeSlug = home.slug;

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'GDPR Status Manager', 'test-setup')`,
    [USERNAME, passwordHash]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'home_manager', 'test-setup')`,
    [USERNAME, homeId]
  );

  const loginRes = await request(app)
    .post('/api/login')
    .send({ username: USERNAME, password: PASSWORD })
    .expect(200);
  token = loginRes.body.token;
}, 15000);

afterAll(async () => {
  if (homeId) {
    await pool.query('DELETE FROM dpia_assessments WHERE home_id = $1', [homeId]).catch(() => {});
    await pool.query('DELETE FROM ropa_activities WHERE home_id = $1', [homeId]).catch(() => {});
  }
  await pool.query('DELETE FROM user_home_roles WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM token_denylist WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM users WHERE username = $1', [USERNAME]).catch(() => {});
  if (homeId) await pool.query('DELETE FROM homes WHERE id = $1', [homeId]).catch(() => {});
});

function auth(method, path) {
  return request(app)[method](path).set('Authorization', `Bearer ${token}`);
}

describe('GDPR status transition routes', () => {
  it('blocks invalid DPIA status jumps while allowing the approved workflow', async () => {
    const createRes = await auth('post', `/api/dpia?home=${homeSlug}`)
      .send({
        title: 'Biometric clock-in',
        processing_description: 'Fingerprint scanners for attendance',
        screening_result: 'required',
      })
      .expect(201);

    const invalidRes = await auth('put', `/api/dpia/${createRes.body.id}?home=${homeSlug}`)
      .send({
        status: 'approved',
        _version: createRes.body.version,
      })
      .expect(400);

    expect(invalidRes.body.error).toMatch(/cannot move from screening to approved/i);

    const inProgress = await auth('put', `/api/dpia/${createRes.body.id}?home=${homeSlug}`)
      .send({
        status: 'in_progress',
        _version: createRes.body.version,
      })
      .expect(200);

    const completed = await auth('put', `/api/dpia/${createRes.body.id}?home=${homeSlug}`)
      .send({
        status: 'completed',
        risk_assessment: 'Medium risk due to biometric data',
        _version: inProgress.body.version,
      })
      .expect(200);

    const approved = await auth('put', `/api/dpia/${createRes.body.id}?home=${homeSlug}`)
      .send({
        status: 'approved',
        approved_by: 'Manager',
        approved_date: '2026-04-12',
        _version: completed.body.version,
      })
      .expect(200);

    expect(approved.body.status).toBe('approved');
  });

  it('blocks archived ROPA items from being reopened directly', async () => {
    const createRes = await auth('post', `/api/ropa?home=${homeSlug}`)
      .send({
        purpose: 'Payroll processing',
        legal_basis: 'legal_obligation',
        categories_of_individuals: 'Staff',
        categories_of_data: 'Financial data',
      })
      .expect(201);

    const underReview = await auth('put', `/api/ropa/${createRes.body.id}?home=${homeSlug}`)
      .send({
        status: 'under_review',
        _version: createRes.body.version,
      })
      .expect(200);

    const archived = await auth('put', `/api/ropa/${createRes.body.id}?home=${homeSlug}`)
      .send({
        status: 'archived',
        _version: underReview.body.version,
      })
      .expect(200);

    const invalidRes = await auth('put', `/api/ropa/${createRes.body.id}?home=${homeSlug}`)
      .send({
        status: 'under_review',
        _version: archived.body.version,
      })
      .expect(400);

    expect(invalidRes.body.error).toMatch(/cannot move from archived to under_review/i);
  });
});
