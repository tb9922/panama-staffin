/**
 * Integration tests for compliance route create flows.
 *
 * Validates that frontend-style empty-string enum values are accepted on
 * create and the saved record shows up in the follow-up list response.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';

const PREFIX = 'compliance-route-test';
const USERNAME = `${PREFIX}-manager`;
const PASSWORD = 'CompliancePass1Test';
const HOME_SLUG = `${PREFIX}-home`;

let token;
let homeId;

beforeAll(async () => {
  await pool.query(`DELETE FROM incident_addenda WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM incidents WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM mca_assessments WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM dols WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug = $1`, [HOME_SLUG]).catch(() => {});

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Compliance Route Test Home', '{}') RETURNING id`,
    [HOME_SLUG]
  );
  homeId = home.id;

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'admin', true, 'Compliance Manager', 'test-setup')`,
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
});

afterAll(async () => {
  await pool.query(`DELETE FROM incident_addenda WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM incidents WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM mca_assessments WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM dols WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug = $1`, [HOME_SLUG]).catch(() => {});
});

describe('Compliance route create flows', () => {
  it('accepts blank optional incident enum fields and returns the created incident in the list response', async () => {
    const createRes = await request(app)
      .post('/api/incidents')
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${token}`)
      .send({
        date: '2026-03-25',
        type: 'fall',
        severity: 'minor',
        description: 'Frontend-style blank optional enum fields',
        person_affected: 'resident',
        cqc_notification_type: '',
        cqc_notification_deadline: '',
      })
      .expect(201);

    expect(createRes.body.id).toBeTruthy();
    expect(createRes.body.cqc_notification_type ?? null).toBeNull();
    expect(createRes.body.cqc_notification_deadline ?? null).toBeNull();

    const listRes = await request(app)
      .get('/api/incidents')
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listRes.body.incidents.some(incident => incident.id === createRes.body.id)).toBe(true);
  });

  it('normalises corrective action status values from frontend payloads', async () => {
    const createRes = await request(app)
      .post('/api/incidents')
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${token}`)
      .send({
        date: '2026-03-26',
        type: 'near_miss',
        severity: 'minor',
        description: 'Corrective action status normalisation',
        corrective_actions: [
          {
            description: 'Review procedure',
            assigned_to: 'Manager',
            due_date: '2026-04-01',
            status: 'open',
          },
        ],
      })
      .expect(201);

    expect(createRes.body.corrective_actions[0].status).toBe('pending');
  });

  it('accepts blank DoLS review_status and returns the created row in the list response', async () => {
    const createRes = await request(app)
      .post('/api/dols')
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${token}`)
      .send({
        resident_name: 'Compliance Route Resident',
        application_type: 'dols',
        application_date: '2026-03-25',
        review_status: '',
        notes: 'Frontend-style blank optional enum field',
      })
      .expect(201);

    expect(createRes.body.id).toBeTruthy();
    expect(createRes.body.review_status ?? null).toBeNull();

    const listRes = await request(app)
      .get('/api/dols')
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listRes.body.dols.some(record => record.id === createRes.body.id)).toBe(true);
  });
});
