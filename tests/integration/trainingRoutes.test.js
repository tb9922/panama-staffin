import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { pool } from '../../db.js';
import { app } from '../../server.js';

const PREFIX = 'training-route-occ';
const USERNAME = `${PREFIX}-manager`;
const PASSWORD = 'TrainingRoute1X';
const STAFF_ID = 'TRN-ROUTE-001';

let homeId;
let homeSlug;
let token;

beforeAll(async () => {
  await pool.query('DELETE FROM training_records WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)', [`${PREFIX}-home`]).catch(() => {});
  await pool.query('DELETE FROM supervisions WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)', [`${PREFIX}-home`]).catch(() => {});
  await pool.query('DELETE FROM appraisals WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)', [`${PREFIX}-home`]).catch(() => {});
  await pool.query('DELETE FROM fire_drills WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)', [`${PREFIX}-home`]).catch(() => {});
  await pool.query('DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)', [`${PREFIX}-home`]).catch(() => {});
  await pool.query('DELETE FROM user_home_roles WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM token_denylist WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM users WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM homes WHERE slug = $1', [`${PREFIX}-home`]).catch(() => {});

  const config = {
    max_al_same_day: 3,
    training_types: [
      { id: 'fire-safety', name: 'Fire Safety', category: 'statutory', refresher_months: 12, roles: null, active: true },
    ],
  };
  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Training OCC Home', $2) RETURNING id, slug`,
    [`${PREFIX}-home`, JSON.stringify(config)]
  );
  homeId = home.id;
  homeSlug = home.slug;

  await pool.query(
    `INSERT INTO staff (id, home_id, name, role, team, skill, hourly_rate, active, wtr_opt_out, start_date)
     VALUES ($1, $2, 'Training Route Staff', 'Carer', 'Day A', 1, 13.00, true, false, '2025-01-01')`,
    [STAFF_ID, homeId]
  );

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Training Route Manager', 'test-setup')`,
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
  await pool.query('DELETE FROM training_records WHERE home_id = $1', [homeId]).catch(() => {});
  await pool.query('DELETE FROM supervisions WHERE home_id = $1', [homeId]).catch(() => {});
  await pool.query('DELETE FROM appraisals WHERE home_id = $1', [homeId]).catch(() => {});
  await pool.query('DELETE FROM fire_drills WHERE home_id = $1', [homeId]).catch(() => {});
  await pool.query('DELETE FROM user_home_roles WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM token_denylist WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM users WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM staff WHERE id = $1 AND home_id = $2', [STAFF_ID, homeId]).catch(() => {});
  await pool.query('DELETE FROM homes WHERE id = $1', [homeId]).catch(() => {});
});

function authRequest(method, path) {
  return request(app)[method](path).set('Authorization', `Bearer ${token}`);
}

describe('training routes optimistic concurrency', () => {
  it('returns configUpdatedAt with the training payload', async () => {
    const res = await authRequest('get', `/api/training?home=${homeSlug}`).expect(200);

    expect(typeof res.body.configUpdatedAt).toBe('string');
    expect(Array.isArray(res.body.trainingTypes)).toBe(true);
  });

  it('updates training types without clobbering unrelated config keys', async () => {
    const loadRes = await authRequest('get', `/api/training?home=${homeSlug}`).expect(200);
    const trainingTypes = [
      ...loadRes.body.trainingTypes,
      { id: 'safeguarding', name: 'Safeguarding', category: 'mandatory', refresher_months: 24, roles: null, active: true },
    ];

    await authRequest('put', `/api/training/config/types?home=${homeSlug}`)
      .send({ trainingTypes, _clientUpdatedAt: loadRes.body.configUpdatedAt })
      .expect(200);

    const { rows: [home] } = await pool.query('SELECT config FROM homes WHERE id = $1', [homeId]);
    expect(home.config.max_al_same_day).toBe(3);
    expect(home.config.training_types).toHaveLength(2);
    expect(home.config.training_types.map(t => t.id)).toContain('safeguarding');
  });

  it('rejects stale training type config updates', async () => {
    const loadRes = await authRequest('get', `/api/training?home=${homeSlug}`).expect(200);
    const staleVersion = loadRes.body.configUpdatedAt;

    await authRequest('put', `/api/training/config/types?home=${homeSlug}`)
      .send({
        trainingTypes: [
          { id: 'fire-safety', name: 'Fire Safety', category: 'statutory', refresher_months: 18, roles: null, active: true },
        ],
        _clientUpdatedAt: staleVersion,
      })
      .expect(200);

    const staleRes = await authRequest('put', `/api/training/config/types?home=${homeSlug}`)
      .send({
        trainingTypes: [
          { id: 'moving-handling', name: 'Moving & Handling', category: 'mandatory', refresher_months: 12, roles: null, active: true },
        ],
        _clientUpdatedAt: staleVersion,
      })
      .expect(409);

    expect(staleRes.body.error).toMatch(/modified by another user/i);
  });

  it('requires _clientUpdatedAt for training type config updates', async () => {
    const res = await authRequest('put', `/api/training/config/types?home=${homeSlug}`)
      .send({
        trainingTypes: [
          { id: 'fire-safety', name: 'Fire Safety', category: 'statutory', refresher_months: 12, roles: null, active: true },
        ],
      })
      .expect(400);

    expect(res.body.error).toBeTruthy();
  });

  it('rejects invalid calendar dates with 400', async () => {
    const res = await authRequest('put', `/api/training/${STAFF_ID}/fire-safety?home=${homeSlug}`)
      .send({
        completed: '2025-02-29',
        expiry: '2026-02-28',
        trainer: 'Test Trainer',
        method: 'classroom',
      })
      .expect(400);

    expect(res.body.error).toBeTruthy();
  });

  it('requires _clientUpdatedAt for named record updates', async () => {
    const createSupervision = await authRequest('post', `/api/training/supervisions?home=${homeSlug}`)
      .send({
        staffId: STAFF_ID,
        date: '2026-04-01',
        supervisor: 'Route Manager',
        topics: 'Initial supervision',
      })
      .expect(201);

    await authRequest('put', `/api/training/supervisions/${createSupervision.body.id}?home=${homeSlug}`)
      .send({
        staffId: STAFF_ID,
        date: '2026-04-02',
        supervisor: 'Route Manager',
        topics: 'Updated supervision',
      })
      .expect(400);

    const createAppraisal = await authRequest('post', `/api/training/appraisals?home=${homeSlug}`)
      .send({
        staffId: STAFF_ID,
        date: '2026-05-01',
        appraiser: 'Route Manager',
        objectives: 'Initial appraisal',
      })
      .expect(201);

    await authRequest('put', `/api/training/appraisals/${createAppraisal.body.id}?home=${homeSlug}`)
      .send({
        staffId: STAFF_ID,
        date: '2026-05-02',
        appraiser: 'Route Manager',
        objectives: 'Updated appraisal',
      })
      .expect(400);

    const createDrill = await authRequest('post', `/api/training/fire-drills?home=${homeSlug}`)
      .send({
        date: '2026-06-01',
        time: '10:00',
        scenario: 'Route drill',
      })
      .expect(201);

    await authRequest('put', `/api/training/fire-drills/${createDrill.body.id}?home=${homeSlug}`)
      .send({
        date: '2026-06-02',
        time: '11:00',
        scenario: 'Updated route drill',
      })
      .expect(400);
  });
});
