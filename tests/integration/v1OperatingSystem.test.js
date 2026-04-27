import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app } from '../../server.js';
import { pool } from '../../db.js';

const PREFIX = 'v1-os-test';
const HOME_A = `${PREFIX}-home-a`;
const HOME_B = `${PREFIX}-home-b`;
const MANAGER = `${PREFIX}-manager`;
const PASSWORD = 'V1OsTest1!';

let homeAId;
let homeBId;
let managerToken;

async function cleanup() {
  const { rows } = await pool.query(`SELECT id FROM homes WHERE slug LIKE $1`, [`${PREFIX}-%`]);
  const homeIds = rows.map(row => row.id);
  for (const homeId of homeIds) {
    await pool.query(`DELETE FROM incidents WHERE home_id = $1`, [homeId]).catch(() => {});
    await pool.query(`DELETE FROM complaints WHERE home_id = $1`, [homeId]).catch(() => {});
    await pool.query(`DELETE FROM audit_tasks WHERE home_id = $1`, [homeId]).catch(() => {});
    await pool.query(`DELETE FROM outcome_metrics WHERE home_id = $1`, [homeId]).catch(() => {});
    await pool.query(`DELETE FROM reflective_practice WHERE home_id = $1`, [homeId]).catch(() => {});
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
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'V1 OS Home A', '{}'::jsonb) RETURNING id`,
    [HOME_A],
  );
  const { rows: [homeB] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'V1 OS Home B', '{}'::jsonb) RETURNING id`,
    [HOME_B],
  );
  homeAId = homeA.id;
  homeBId = homeB.id;

  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'V1 OS Manager', 'test-setup')`,
    [MANAGER, hash],
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'home_manager', 'test-setup')`,
    [MANAGER, homeAId],
  );

  const login = await request(app).post('/api/login').send({ username: MANAGER, password: PASSWORD }).expect(200);
  managerToken = login.body.token;
}, 20000);

afterAll(async () => {
  await cleanup();
});

function authed(method, path) {
  return request(app)[method](path).set('Authorization', `Bearer ${managerToken}`);
}

describe('V1 operating-system API foundations', () => {
  it('creates, lists and completes audit calendar tasks with tenant isolation', async () => {
    void homeBId;
    const created = await authed('post', `/api/audit-tasks?home=${HOME_A}`)
      .send({
        title: 'Weekly MAR audit',
        category: 'medication',
        frequency: 'weekly',
        due_date: '2026-04-30',
        evidence_required: true,
      })
      .expect(201);

    expect(created.body.id).toBeGreaterThan(0);
    expect(created.body.status).toBe('open');

    const listed = await authed('get', `/api/audit-tasks?home=${HOME_A}`).expect(200);
    expect(listed.body.tasks.some(task => task.id === created.body.id)).toBe(true);

    const completed = await authed('post', `/api/audit-tasks/${created.body.id}/complete?home=${HOME_A}`)
      .send({ _version: created.body.version, evidence_notes: 'Signed off by manager.' })
      .expect(200);

    expect(completed.body.status).toBe('completed');
    expect(completed.body.completed_at).toBeTruthy();

    await authed('get', `/api/audit-tasks?home=${HOME_B}`).expect(403);
  });

  it('generates recurring audit calendar tasks idempotently', async () => {
    const first = await authed('post', `/api/audit-tasks/generate?home=${HOME_A}`)
      .send({ from: '2026-04-01', to: '2026-04-07' })
      .expect(201);

    expect(first.body.planned).toBeGreaterThan(0);
    expect(first.body.inserted).toBeGreaterThan(0);
    expect(first.body.tasks.some(task => task.template_key === 'daily_mar_check')).toBe(true);

    const second = await authed('post', `/api/audit-tasks/generate?home=${HOME_A}`)
      .send({ from: '2026-04-01', to: '2026-04-07' })
      .expect(201);

    expect(second.body.planned).toBe(first.body.planned);
    expect(second.body.inserted).toBe(0);
  });

  it('captures manual outcome metrics and returns them on the dashboard', async () => {
    await pool.query(
      `INSERT INTO incidents (
         id, home_id, date, time, location, type, severity, person_affected_name,
         investigation_status, investigation_review_date, root_cause
       ) VALUES
         ('v1-inc-1', $1, CURRENT_DATE - INTERVAL '1 day', '08:00', 'Lounge', 'Fall', 'medium', 'Resident A', 'open', CURRENT_DATE - INTERVAL '1 day', 'Environment'),
         ('v1-inc-2', $1, CURRENT_DATE - INTERVAL '2 days', '09:00', 'Lounge', 'Fall', 'medium', 'Resident A', 'open', CURRENT_DATE - INTERVAL '1 day', 'Environment')
       ON CONFLICT (home_id, id) DO NOTHING`,
      [homeAId],
    );
    await pool.query(
      `INSERT INTO complaints (
         id, home_id, date, raised_by, raised_by_name, category, title,
         acknowledged_date, response_deadline, status, root_cause
       ) VALUES
         ('v1-cmp-1', $1, CURRENT_DATE - INTERVAL '5 days', 'relative', 'Family A', 'communication', 'Slow update', NULL, CURRENT_DATE - INTERVAL '1 day', 'open', 'Communication'),
         ('v1-cmp-2', $1, CURRENT_DATE - INTERVAL '4 days', 'relative', 'Family A', 'communication', 'Slow update again', NULL, CURRENT_DATE + INTERVAL '7 days', 'open', 'Communication')
       ON CONFLICT (home_id, id) DO NOTHING`,
      [homeAId],
    );

    const created = await authed('post', `/api/outcomes/metrics?home=${HOME_A}`)
      .send({
        metric_key: 'prn_antipsychotic_pct',
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        numerator: 2,
        denominator: 30,
        notes: 'Monthly governance review.',
      })
      .expect(201);

    expect(created.body.metric_key).toBe('prn_antipsychotic_pct');
    expect(created.body.numerator).toBe(2);

    const dashboard = await authed('get', `/api/outcomes/dashboard?home=${HOME_A}`).expect(200);
    expect(dashboard.body.derived).toHaveProperty('incidents');
    expect(dashboard.body.manual.some(metric => metric.id === created.body.id)).toBe(true);
    expect(dashboard.body.derived.trends.incidents.by_category[0]).toMatchObject({ label: 'Fall', count: 2 });
    expect(dashboard.body.derived.trends.incidents.recurrence[0]).toMatchObject({ subject: 'Resident A', category: 'Fall', count: 2 });
    expect(dashboard.body.derived.trends.complaints.by_category[0]).toMatchObject({ label: 'communication', count: 2 });
    expect(dashboard.body.derived.trends.complaints.overdue.acknowledgement_overdue).toBeGreaterThanOrEqual(1);
  });

  it('creates, updates and deletes reflective-practice records', async () => {
    const created = await authed('post', `/api/reflective-practice?home=${HOME_A}`)
      .send({
        staff_id: 'V1001',
        practice_date: '2026-04-26',
        facilitator: 'Deputy manager',
        category: 'reflective_practice',
        topic: 'Falls learning huddle',
        reflection: 'Team reviewed pattern and prevention actions.',
        learning_outcome: 'Night checks adjusted.',
        action_summary: 'Create manager action for sensor review.',
      })
      .expect(201);

    expect(created.body.topic).toBe('Falls learning huddle');

    const listed = await authed('get', `/api/reflective-practice?home=${HOME_A}`).expect(200);
    expect(listed.body.entries.some(entry => entry.id === created.body.id)).toBe(true);

    const updated = await authed('put', `/api/reflective-practice/${created.body.id}?home=${HOME_A}`)
      .send({ _version: created.body.version, topic: 'Falls learning review' })
      .expect(200);

    expect(updated.body.topic).toBe('Falls learning review');

    await authed('delete', `/api/reflective-practice/${created.body.id}?home=${HOME_A}`).expect(200);
    const afterDelete = await authed('get', `/api/reflective-practice?home=${HOME_A}`).expect(200);
    expect(afterDelete.body.entries.some(entry => entry.id === created.body.id)).toBe(false);
  });
});
