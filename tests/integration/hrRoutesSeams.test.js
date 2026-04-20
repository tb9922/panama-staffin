import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';
import { app } from '../../server.js';

process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);

const PREFIX = 'hr-seam-test';
const USERNAME = `${PREFIX}-manager`;
const PASSWORD = 'HrSeamPass1Test';
const HOME_SLUG = `${PREFIX}-home`;
const STAFF_ID = 'HRS001';

let token;
let homeId;

beforeAll(async () => {
  await pool.query(`DELETE FROM hr_flexible_working WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_edi_records WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_tupe_transfers WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_rtw_dbs_renewals WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE id = $1`, [STAFF_ID]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug = $1`, [HOME_SLUG]).catch(() => {});

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'HR Seam Test Home', '{}') RETURNING id`,
    [HOME_SLUG]
  );
  homeId = home.id;

  await pool.query(
    `INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out, start_date)
     VALUES ($1, $2, 'HR Seam Staff', 'Carer', 'Day A', 'E', 1, 13.00, true, false, '2026-01-01')`,
    [STAFF_ID, homeId]
  );

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'admin', true, 'HR Seam Manager', 'test-setup')`,
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
  await pool.query(`DELETE FROM hr_flexible_working WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_edi_records WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_tupe_transfers WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM hr_rtw_dbs_renewals WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [HOME_SLUG]).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE id = $1`, [STAFF_ID]).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username = $1`, [USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug = $1`, [HOME_SLUG]).catch(() => {});
});

function authed(method, path) {
  return request(app)[method](path)
    .query({ home: HOME_SLUG })
    .set('Authorization', `Bearer ${token}`);
}

describe('HR route save seams', () => {
  it('auto-computes the flexible working decision deadline from the request date when omitted', async () => {
    const createRes = await authed('post', '/api/hr/flexible-working').send({
      staff_id: STAFF_ID,
      request_date: '2026-03-01',
      requested_change: 'Compressed hours over 4 days',
      status: 'pending',
    }).expect(201);

    expect(createRes.body.decision_deadline).toBe('2026-05-01');
  });

  it('allows withdrawing a flexible working request with free-text decision notes', async () => {
    const createRes = await authed('post', '/api/hr/flexible-working').send({
      staff_id: STAFF_ID,
      request_date: '2026-03-01',
      requested_change: 'Compressed hours over 4 days',
      decision_deadline: '2026-05-01',
      status: 'pending',
    }).expect(201);

    const updateRes = await authed('put', `/api/hr/flexible-working/${createRes.body.id}`).send({
      _version: createRes.body.version,
      decision: 'withdrawn',
      status: 'withdrawn',
      decision_reason: 'Employee withdrew request',
    }).expect(200);

    expect(updateRes.body.status).toBe('withdrawn');
    expect(updateRes.body.decision).toBe('withdrawn');
    expect(updateRes.body.decision_reason).toBe('Employee withdrew request');
  });

  it('creates and updates a reasonable adjustment EDI record with free-text category', async () => {
    const createRes = await authed('post', '/api/hr/edi').send({
      record_type: 'reasonable_adjustment',
      staff_id: STAFF_ID,
      date_recorded: '2026-03-02',
      category: 'Physical',
      condition_description: 'Back injury requiring adapted workstation',
      adjustments: ['Height-adjustable desk'],
      status: 'open',
    }).expect(201);

    expect(createRes.body.category).toBe('Physical');
    expect(createRes.body.adjustments).toEqual(['Height-adjustable desk']);

    const { rows: [stored] } = await pool.query(
      `SELECT condition_description, adjustments, sensitive_encrypted, sensitive_iv, sensitive_tag
         FROM hr_edi_records
        WHERE id = $1 AND home_id = $2`,
      [createRes.body.id, homeId]
    );
    expect(stored.condition_description).toBeNull();
    expect(stored.adjustments).toEqual([]);
    expect(stored.sensitive_encrypted).toBeTruthy();
    expect(stored.sensitive_iv).toBeTruthy();
    expect(stored.sensitive_tag).toBeTruthy();

    const updateRes = await authed('put', `/api/hr/edi/${createRes.body.id}`).send({
      _version: createRes.body.version,
      category: 'Sensory',
      adjustments: ['Screen reader software'],
    }).expect(200);

    expect(updateRes.body.category).toBe('Sensory');
    expect(updateRes.body.adjustments).toEqual(['Screen reader software']);
  });

  it('links HR case notes to the staff subject automatically', async () => {
    const disciplinary = await authed('post', '/api/hr/cases/disciplinary').send({
      staff_id: STAFF_ID,
      date_raised: '2026-03-10',
      category: 'conduct',
      allegation_summary: 'Case note subject-link test',
      raised_by: 'HR Seam Manager',
      source: 'observation',
      status: 'open',
    }).expect(201);

    const noteRes = await authed('post', `/api/hr/case-notes/disciplinary/${disciplinary.body.id}`).send({
      note: 'Linked note for disciplinary case',
    }).expect(201);

    expect(noteRes.body.subject_type).toBe('staff');
    expect(noteRes.body.subject_id).toBe(STAFF_ID);
  });

  it('rejects TUPE consultation windows shorter than 30 days', async () => {
    const createRes = await authed('post', '/api/hr/tupe').send({
      transfer_type: 'incoming',
      transfer_date: '2026-06-01',
      transferor_name: 'OldCo Care Services',
      transferee_name: 'NewCo Care Group',
      staff_affected: 12,
      consultation_start: '2026-04-01',
      consultation_end: '2026-04-15',
      status: 'consultation',
    }).expect(400);

    expect(createRes.body.error).toMatch(/at least 30 days/i);
  });

  it('persists TUPE consultation, ELI, and measures fields on create and update', async () => {
    const createRes = await authed('post', '/api/hr/tupe').send({
      transfer_type: 'incoming',
      transfer_date: '2026-06-01',
      transferor_name: 'OldCo Care Services',
      transferee_name: 'NewCo Care Group',
      staff_affected: 12,
      consultation_start: '2026-04-01',
      consultation_end: '2026-05-15',
      eli_sent_date: '2026-03-15',
      measures_proposed: 'No redundancies planned',
      status: 'consultation',
    }).expect(201);

    expect(createRes.body.staff_affected).toBe(12);
    expect(createRes.body.consultation_start).toBe('2026-04-01');
    expect(createRes.body.consultation_end).toBe('2026-05-15');
    expect(createRes.body.eli_sent_date).toBe('2026-03-15');
    expect(createRes.body.measures_proposed).toBe('No redundancies planned');

    const updateRes = await authed('put', `/api/hr/tupe/${createRes.body.id}`).send({
      _version: createRes.body.version,
      consultation_end: '2026-05-20',
      eli_sent_date: '2026-03-20',
      measures_proposed: 'Revised consultation pack issued',
    }).expect(200);

    expect(updateRes.body.consultation_end).toBe('2026-05-20');
    expect(updateRes.body.eli_sent_date).toBe('2026-03-20');
    expect(updateRes.body.measures_proposed).toBe('Revised consultation pack issued');
  });

  it('accepts user-facing RTW document labels and normalizes them', async () => {
    const createRes = await authed('post', '/api/hr/renewals').send({
      staff_id: STAFF_ID,
      check_type: 'rtw',
      last_checked: '2026-03-03',
      expiry_date: '2027-03-03',
      document_type: 'BRP',
      status: 'current',
    }).expect(201);

    expect(createRes.body.document_type).toBe('brp');
    expect(createRes.body.last_checked).toBe('2026-03-03');
    expect(createRes.body.expiry_date).toBe('2027-03-03');
  });
});
