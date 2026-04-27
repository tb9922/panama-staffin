import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app } from '../../server.js';
import { pool } from '../../db.js';

const PREFIX = 'action-items-test';
const HOME_A = `${PREFIX}-home-a`;
const HOME_B = `${PREFIX}-home-b`;
const MANAGER = `${PREFIX}-manager`;
const OTHER_MANAGER = `${PREFIX}-other-manager`;
const PASSWORD = 'ActionItemsTest1!';

let homeAId;
let homeBId;
let managerToken;
let otherUserId;

async function cleanup() {
  const { rows } = await pool.query(`SELECT id FROM homes WHERE slug LIKE $1`, [`${PREFIX}-%`]);
  const homeIds = rows.map(row => row.id);
  for (const homeId of homeIds) {
    await pool.query(`DELETE FROM action_items WHERE home_id = $1`, [homeId]).catch(() => {});
    await pool.query(`DELETE FROM audit_log WHERE home_slug LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  }
  await pool.query(`DELETE FROM user_home_roles WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE $1`, [`${PREFIX}-%`]).catch(() => {});
}

beforeAll(async () => {
  await cleanup();

  const { rows: [homeA] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Action Items Home A', '{}'::jsonb) RETURNING id`,
    [HOME_A]
  );
  const { rows: [homeB] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Action Items Home B', '{}'::jsonb) RETURNING id`,
    [HOME_B]
  );
  homeAId = homeA.id;
  homeBId = homeB.id;

  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Action Manager', 'test-setup')
     RETURNING id`,
    [MANAGER, hash]
  );
  const { rows: [other] } = await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Other Manager', 'test-setup')
     RETURNING id`,
    [OTHER_MANAGER, hash]
  );
  otherUserId = other.id;

  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'home_manager', 'test-setup')`,
    [MANAGER, homeAId]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'home_manager', 'test-setup')`,
    [OTHER_MANAGER, homeBId]
  );

  const login = await request(app).post('/api/login').send({ username: MANAGER, password: PASSWORD }).expect(200);
  managerToken = login.body.token;
}, 20000);

afterAll(async () => {
  await cleanup();
});

describe('action items API', () => {
  it('creates, lists, completes and verifies manager actions for the selected home', async () => {
    const created = await request(app)
      .post(`/api/action-items?home=${HOME_A}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        title: 'Close fire drill action',
        description: 'Upload evidence and sign off the learning action.',
        category: 'compliance',
        priority: 'critical',
        due_date: '2026-04-26',
        owner_name: 'Home Manager',
        evidence_required: true,
      })
      .expect(201);

    expect(created.body.id).toBeGreaterThan(0);
    expect(created.body.escalation_level).toBeGreaterThanOrEqual(1);

    const listed = await request(app)
      .get(`/api/action-items?home=${HOME_A}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    expect(listed.body.actionItems.some(item => item.id === created.body.id)).toBe(true);

    const completed = await request(app)
      .post(`/api/action-items/${created.body.id}/complete?home=${HOME_A}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ _version: created.body.version, evidence_notes: 'Evidence uploaded.' })
      .expect(200);

    expect(completed.body.status).toBe('completed');
    expect(completed.body.evidence_notes).toBe('Evidence uploaded.');

    const verified = await request(app)
      .post(`/api/action-items/${created.body.id}/verify?home=${HOME_A}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ _version: completed.body.version })
      .expect(200);

    expect(verified.body.status).toBe('verified');
  });

  it('enforces tenant isolation through home access', async () => {
    await request(app)
      .get(`/api/action-items?home=${HOME_B}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(403);
  });

  it('rejects owner users who are not assigned to the current home', async () => {
    const res = await request(app)
      .post(`/api/action-items?home=${HOME_A}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        title: 'Bad owner',
        category: 'governance',
        priority: 'medium',
        due_date: '2026-04-30',
        owner_user_id: otherUserId,
      })
      .expect(400);

    expect(res.body.error).toMatch(/owner user/i);
  });

  it('returns clear missing and invalid-state responses on workflow actions', async () => {
    await request(app)
      .post(`/api/action-items/999999999/complete?home=${HOME_A}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({})
      .expect(404);

    const created = await request(app)
      .post(`/api/action-items?home=${HOME_A}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        title: 'Verify only after completion',
        category: 'governance',
        priority: 'medium',
        due_date: '2026-04-30',
      })
      .expect(201);

    await request(app)
      .post(`/api/action-items/${created.body.id}/verify?home=${HOME_A}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ _version: created.body.version })
      .expect(400);
  });
});
