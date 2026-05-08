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

const RUN_ID = Date.now().toString(36).slice(-6);
const PREFIX = `compliance-route-${RUN_ID}`;
const USERNAME = `${PREFIX}-manager`;
const TRAINING_USERNAME = `${PREFIX}-training-lead`;
const PASSWORD = 'CompliancePass1Test';
const HOME_SLUG = `${PREFIX}-home`;
const STAFF_ID = `CP${RUN_ID}`.slice(0, 20);

let token;
let trainingLeadToken;
let homeId;

beforeAll(async () => {
  await pool.query(`DELETE FROM onboarding WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM incident_addenda WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM incidents WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM mca_assessments WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM dols WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE id = $1`, [STAFF_ID]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug = $1`, [HOME_SLUG]).catch(() => {});

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'Compliance Route Test Home', '{}') RETURNING id`,
    [HOME_SLUG]
  );
  homeId = home.id;

  await pool.query(
    `INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out, start_date)
     VALUES ($1, $2, 'Compliance Route Staff', 'Carer', 'Day A', 'E', 1, 13.00, true, false, '2026-01-01')`,
    [STAFF_ID, homeId]
  );

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'admin', true, 'Compliance Manager', 'test-setup')`,
    [USERNAME, passwordHash]
  );
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Compliance Training Lead', 'test-setup')`,
    [TRAINING_USERNAME, passwordHash]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'home_manager', 'test-setup')`,
    [USERNAME, homeId]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'training_lead', 'test-setup')`,
    [TRAINING_USERNAME, homeId]
  );

  const loginRes = await request(app)
    .post('/api/login')
    .send({ username: USERNAME, password: PASSWORD })
    .expect(200);
  token = loginRes.body.token;
  const trainingLeadLoginRes = await request(app)
    .post('/api/login')
    .send({ username: TRAINING_USERNAME, password: PASSWORD })
    .expect(200);
  trainingLeadToken = trainingLeadLoginRes.body.token;
});

afterAll(async () => {
  await pool.query(`DELETE FROM onboarding WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM incident_addenda WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM incidents WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM mca_assessments WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM dols WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE id = $1`, [STAFF_ID]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [TRAINING_USERNAME]).catch(() => {});
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

  it('accepts HH:mm:ss incident time values and returns HH:mm values', async () => {
    const createRes = await request(app)
      .post('/api/incidents')
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${token}`)
      .send({
        date: '2026-03-27',
        time: '09:15:00',
        type: 'fall',
        severity: 'minor',
        description: 'Database-style time values',
        cqc_notifiable: true,
        cqc_notification_type: 'serious_injury',
        cqc_notified: true,
        cqc_notified_date: '2026-03-27',
        cqc_notified_time: '10:20:00',
        riddor_reportable: true,
        riddor_category: 'specified_injury',
        riddor_reported: true,
        riddor_reported_date: '2026-03-27',
        riddor_reported_time: '11:25:00',
      })
      .expect(201);

    expect(createRes.body.time).toBe('09:15');
    expect(createRes.body.cqc_notified_time).toBe('10:20');
    expect(createRes.body.riddor_reported_time).toBe('11:25');

    const updateRes = await request(app)
      .put(`/api/incidents/${createRes.body.id}`)
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${token}`)
      .send({
        _version: createRes.body.version,
        time: '12:30:00',
        cqc_notified_time: '13:35:00',
        riddor_reported_time: '14:40:00',
      })
      .expect(200);

    expect(updateRes.body.time).toBe('12:30');
    expect(updateRes.body.cqc_notified_time).toBe('13:35');
    expect(updateRes.body.riddor_reported_time).toBe('14:40');
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

  it('rejects DoLS authorisations longer than 12 months', async () => {
    const res = await request(app)
      .post('/api/dols')
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${token}`)
      .send({
        resident_name: 'Overlong Authorisation Resident',
        application_type: 'dols',
        application_date: '2026-03-25',
        authorised: true,
        authorisation_date: '2026-03-25',
        expiry_date: '2027-03-26',
      })
      .expect(400);

    expect(res.body.error).toContain('12 months');
  });

  it('redacts DoLS and MCA special-category details for training leads', async () => {
    const dolsRes = await request(app)
      .post('/api/dols')
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${token}`)
      .send({
        resident_name: 'Redacted DoLS Resident',
        dob: '1934-05-06',
        room_number: '11',
        application_type: 'dols',
        application_date: '2026-03-25',
        authorised: true,
        authorisation_date: '2026-03-25',
        expiry_date: '2027-03-25',
        authorisation_number: 'AUTH-SENSITIVE-1',
        authorising_authority: 'Sensitive Authority',
        restrictions: ['Line of sight observation'],
        notes: 'Sensitive DoLS narrative',
      })
      .expect(201);

    const mcaRes = await request(app)
      .post('/api/dols/mca')
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${token}`)
      .send({
        resident_name: 'Redacted MCA Resident',
        assessment_date: '2026-03-25',
        assessor: 'Dr Capacity',
        decision_area: 'Medical treatment',
        lacks_capacity: true,
        best_interest_decision: 'Sensitive best-interest decision',
        next_review_date: '2026-09-25',
        notes: 'Sensitive MCA note',
      })
      .expect(201);

    const listRes = await request(app)
      .get('/api/dols')
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${trainingLeadToken}`)
      .expect(200);

    const dolsRecord = listRes.body.dols.find(record => record.id === dolsRes.body.id);
    expect(dolsRecord).toBeTruthy();
    expect(dolsRecord).not.toHaveProperty('dob');
    expect(dolsRecord).not.toHaveProperty('authorisation_number');
    expect(dolsRecord).not.toHaveProperty('authorising_authority');
    expect(dolsRecord).not.toHaveProperty('restrictions');
    expect(dolsRecord).not.toHaveProperty('notes');

    const mcaRecord = listRes.body.mcaAssessments.find(record => record.id === mcaRes.body.id);
    expect(mcaRecord).toBeTruthy();
    expect(mcaRecord).not.toHaveProperty('lacks_capacity');
    expect(mcaRecord).not.toHaveProperty('decision_area');
    expect(mcaRecord).not.toHaveProperty('best_interest_decision');
    expect(mcaRecord).not.toHaveProperty('notes');
  });

  it('blocks training leads from writing DoLS records', async () => {
    await request(app)
      .post('/api/dols')
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${trainingLeadToken}`)
      .send({
        resident_name: 'Training Lead Write Block',
        application_type: 'dols',
        application_date: '2026-03-25',
      })
      .expect(403);
  });

  it('accepts onboarding section-specific keys from the tracker UI', async () => {
    const saveRes = await request(app)
      .put(`/api/onboarding/${STAFF_ID}/contract`)
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${token}`)
      .send({
        status: 'completed',
        contract_type: 'permanent',
        document_type: 'written_statement',
        notes: 'Saved from onboarding tracker',
      })
      .expect(200);

    expect(saveRes.body.contract.contract_type).toBe('permanent');
    expect(saveRes.body.contract.document_type).toBe('written_statement');
  });

  it('rejects legacy IPC outbreak status values that would backtrack a confirmed outbreak', async () => {
    const createRes = await request(app)
      .post('/api/ipc')
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${token}`)
      .send({
        audit_date: '2026-03-28',
        audit_type: 'outbreak',
        outbreak: {
          suspected: true,
          type: 'Norovirus',
          status: 'confirmed',
        },
      })
      .expect(201);

    const updateRes = await request(app)
      .put(`/api/ipc/${createRes.body.id}`)
      .query({ home: HOME_SLUG })
      .set('Authorization', `Bearer ${token}`)
      .send({
        _version: createRes.body.version,
        outbreak: {
          suspected: true,
          type: 'Norovirus',
          status: 'open',
        },
      })
      .expect(400);

    expect(updateRes.body.error).toContain('cannot move');
  });
});
