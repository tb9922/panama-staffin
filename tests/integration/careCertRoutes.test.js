import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { pool } from '../../db.js';
import { app } from '../../server.js';

const PREFIX = 'care-cert-route';
const USERNAME = `${PREFIX}-manager`;
const PASSWORD = 'CareCertRoute1X';
const STAFF_ID = 'CC-ROUTE-001';

let homeId;
let homeSlug;
let token;

beforeAll(async () => {
  await pool.query('DELETE FROM care_certificates WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)', [`${PREFIX}-home`]).catch(() => {});
  await pool.query('DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)', [`${PREFIX}-home`]).catch(() => {});
  await pool.query('DELETE FROM user_home_roles WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM token_denylist WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM users WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM homes WHERE slug = $1', [`${PREFIX}-home`]).catch(() => {});

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Care Certificate Route Home', $2) RETURNING id, slug`,
    [`${PREFIX}-home`, JSON.stringify({ home_name: 'Care Certificate Route Home' })]
  );
  homeId = home.id;
  homeSlug = home.slug;

  await pool.query(
    `INSERT INTO staff (id, home_id, name, role, team, skill, hourly_rate, active, wtr_opt_out, start_date)
     VALUES ($1, $2, 'Care Certificate Route Staff', 'Carer', 'Day A', 1, 13.00, true, false, '2026-01-01')`,
    [STAFF_ID, homeId]
  );

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Care Certificate Route Manager', 'test-setup')`,
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
  await pool.query('DELETE FROM care_certificates WHERE home_id = $1', [homeId]).catch(() => {});
  await pool.query('DELETE FROM staff WHERE id = $1 AND home_id = $2', [STAFF_ID, homeId]).catch(() => {});
  await pool.query('DELETE FROM user_home_roles WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM token_denylist WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM users WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM homes WHERE id = $1', [homeId]).catch(() => {});
});

function authRequest(method, path) {
  return request(app)[method](path).set('Authorization', `Bearer ${token}`);
}

describe('care certificate routes', () => {
  it('persists standard assessor and notes from the detail modal shape', async () => {
    await authRequest('post', `/api/care-cert?home=${homeSlug}`)
      .send({
        staffId: STAFF_ID,
        start_date: '2026-05-01',
        supervisor: 'Route Supervisor',
      })
      .expect(201);

    await authRequest('put', `/api/care-cert/${STAFF_ID}?home=${homeSlug}`)
      .send({
        standards: {
          'std-1': {
            status: 'passed',
            completion_date: '2026-05-05',
            assessor: 'Route Assessor',
            notes: 'Observed safe practice in shadow shift.',
          },
        },
      })
      .expect(200);

    const listed = await authRequest('get', `/api/care-cert?home=${homeSlug}`).expect(200);
    expect(listed.body.careCert[STAFF_ID].standards['std-1']).toMatchObject({
      status: 'passed',
      completion_date: '2026-05-05',
      assessor: 'Route Assessor',
      notes: 'Observed safe practice in shadow shift.',
    });
  });
});
