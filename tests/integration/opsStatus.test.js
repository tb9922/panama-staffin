import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app } from '../../server.js';
import { pool } from '../../db.js';

const PREFIX = 'ops-status-test';
const PLATFORM_ADMIN = `${PREFIX}-platform`;
const HOME_ADMIN = `${PREFIX}-admin`;
const PASSWORD = 'OpsStatusTest1!';
let platformToken;
let homeAdminToken;

async function cleanup() {
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by, is_platform_admin)
     VALUES
       ($1, $3, 'admin', true, 'Ops Platform Admin', 'test-setup', true),
       ($2, $3, 'admin', true, 'Ops Home Admin', 'test-setup', false)`,
    [PLATFORM_ADMIN, HOME_ADMIN, hash],
  );

  const platformLogin = await request(app).post('/api/login').send({ username: PLATFORM_ADMIN, password: PASSWORD }).expect(200);
  platformToken = platformLogin.body.token;
  const adminLogin = await request(app).post('/api/login').send({ username: HOME_ADMIN, password: PASSWORD }).expect(200);
  homeAdminToken = adminLogin.body.token;
}, 15000);

afterAll(async () => {
  await cleanup();
});

describe('ops status API', () => {
  it('requires platform admin access', async () => {
    await request(app).get('/api/ops/status').expect(401);
    await request(app)
      .get('/api/ops/status')
      .set('Authorization', `Bearer ${homeAdminToken}`)
      .expect(403);
  });

  it('returns read-only operational signals without secrets', async () => {
    const res = await request(app)
      .get('/api/ops/status')
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(200);

    expect(res.headers['cache-control']).toContain('no-store');
    expect(['ok', 'warning', 'error']).toContain(res.body.overall);
    expect(res.body.runtime).toMatchObject({
      environment: expect.any(String),
      node_version: expect.any(String),
    });
    expect(res.body.database.pool).toHaveProperty('max');
    expect(res.body.upload_scanner).toHaveProperty('configured');
    expect(res.body.security).toHaveProperty('metrics_endpoint_protected');

    const serialized = JSON.stringify(res.body).toLowerCase();
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('jwt_secret');
    expect(serialized).not.toContain('db_password');
  });
});
