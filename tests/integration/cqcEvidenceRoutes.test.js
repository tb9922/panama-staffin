import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { pool } from '../../db.js';
import { app } from '../../server.js';

const PREFIX = 'cqc-ready-route';
const USERNAME = `${PREFIX}-manager`;
const PASSWORD = 'CqcReady1!';

let homeId;
let homeSlug;
let token;
let evidenceId;

beforeAll(async () => {
  await pool.query(`DELETE FROM cqc_partner_feedback WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]).catch(() => {});
  await pool.query(`DELETE FROM cqc_observations WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]).catch(() => {});
  await pool.query(`DELETE FROM cqc_statement_narratives WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]).catch(() => {});
  await pool.query(`DELETE FROM cqc_evidence WHERE home_id IN (SELECT id FROM homes WHERE slug = $1)`, [`${PREFIX}-home`]).catch(() => {});
  await pool.query('DELETE FROM user_home_roles WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM token_denylist WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM users WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM homes WHERE slug = $1', [`${PREFIX}-home`]).catch(() => {});

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, 'CQC Ready Route Home', '{}'::jsonb) RETURNING id, slug`,
    [`${PREFIX}-home`]
  );
  homeId = home.id;
  homeSlug = home.slug;

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'CQC Ready Manager', 'test-setup')`,
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
    await pool.query('DELETE FROM cqc_partner_feedback WHERE home_id = $1', [homeId]).catch(() => {});
    await pool.query('DELETE FROM cqc_observations WHERE home_id = $1', [homeId]).catch(() => {});
    await pool.query('DELETE FROM cqc_statement_narratives WHERE home_id = $1', [homeId]).catch(() => {});
    await pool.query('DELETE FROM cqc_evidence WHERE home_id = $1', [homeId]).catch(() => {});
  }
  await pool.query('DELETE FROM user_home_roles WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM token_denylist WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM users WHERE username = $1', [USERNAME]).catch(() => {});
  if (homeId) await pool.query('DELETE FROM homes WHERE id = $1', [homeId]).catch(() => {});
});

function auth(method, path) {
  return request(app)[method](path).set('Authorization', `Bearer ${token}`);
}

describe('cqc evidence routes readiness contract', () => {
  it('round-trips evidence owner and review due, normalizing legacy evidence categories', async () => {
    const createRes = await auth('post', `/api/cqc-evidence?home=${homeSlug}`)
      .send({
        quality_statement: 'S1',
        type: 'qualitative',
        title: 'Learning review',
        description: 'Team review after incident',
        evidence_category: 'feedback',
        evidence_owner: 'Deputy Manager',
        review_due: '2026-06-30',
      })
      .expect(201);

    evidenceId = createRes.body.id;
    expect(createRes.body.evidence_category).toBe('staff_leader_feedback');
    expect(createRes.body.evidence_owner).toBe('Deputy Manager');
    expect(createRes.body.review_due).toBe('2026-06-30');
    expect(createRes.body.file_count).toBe(0);

    const listRes = await auth('get', `/api/cqc-evidence?home=${homeSlug}`).expect(200);
    expect(listRes.body.evidence[0].id).toBe(evidenceId);
    expect(listRes.body.evidence[0].evidence_owner).toBe('Deputy Manager');
    expect(listRes.body.evidence[0].review_due).toBe('2026-06-30');
    expect(listRes.body.evidence[0].file_count).toBe(0);
  });

  it('rejects evidence where the end date is before the start date', async () => {
    const res = await auth('post', `/api/cqc-evidence?home=${homeSlug}`)
      .send({
        quality_statement: 'S2',
        type: 'qualitative',
        title: 'Broken date range',
        date_from: '2026-04-17',
        date_to: '2026-04-16',
        evidence_category: 'peoples_experience',
      })
      .expect(400);

    expect(res.body.error).toMatch(/Evidence To cannot be before Evidence From/i);
  });

  it('supports narrative upsert and list endpoints with optimistic locking payloads', async () => {
    const putRes = await auth('put', `/api/cqc-evidence/narratives/S1?home=${homeSlug}`)
      .send({
        narrative: 'The evidence shows incident learning is discussed weekly.',
        risks: 'Night-shift follow-up can still be inconsistent.',
        actions: 'Add learning review to every handover agenda.',
        reviewed_by: 'Deputy Manager',
        reviewed_at: '2026-04-12T09:00:00Z',
        review_due: '2026-07-12',
      })
      .expect(200);

    expect(putRes.body.quality_statement).toBe('S1');
    expect(putRes.body.version).toBe(1);

    const staleRes = await auth('put', `/api/cqc-evidence/narratives/S1?home=${homeSlug}`)
      .send({
        narrative: 'Outdated update',
        _version: 0,
      })
      .expect(409);

    expect(staleRes.body.error).toMatch(/modified by another user/i);

    const listRes = await auth('get', `/api/cqc-evidence/narratives?home=${homeSlug}`).expect(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body[0].quality_statement).toBe('S1');
    expect(listRes.body[0].review_due).toBe('2026-07-12');
  });

  it('returns a server-authored readiness summary for the home', async () => {
    const res = await auth('get', `/api/cqc-evidence/readiness?home=${homeSlug}&dateRange=28`).expect(200);

    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(Array.isArray(res.body.questionSummary)).toBe(true);
    expect(Array.isArray(res.body.gaps)).toBe(true);

    const s1 = res.body.entries.find((entry) => entry.statementId === 'S1');
    expect(s1).toBeTruthy();
    expect(typeof s1.summary).toBe('string');
  });

  it('creates, updates, lists, and deletes structured partner feedback', async () => {
    const createRes = await auth('post', `/api/cqc-evidence/partner-feedback?home=${homeSlug}`)
      .send({
        quality_statement: 'WL6',
        feedback_date: '2026-04-10',
        title: 'Family review',
        partner_name: 'Relative A',
        partner_role: 'Family',
        summary: 'Communication was calm and clear.',
        response_action: 'Keep using weekly updates.',
        evidence_owner: 'Deputy Manager',
        review_due: '2026-07-12',
      })
      .expect(201);

    const updateRes = await auth('put', `/api/cqc-evidence/partner-feedback/${createRes.body.id}?home=${homeSlug}`)
      .send({
        summary: 'Communication was calm and consistently clear.',
        _version: createRes.body.version,
      })
      .expect(200);

    expect(updateRes.body.version).toBe(2);

    const listRes = await auth('get', `/api/cqc-evidence/partner-feedback?home=${homeSlug}`).expect(200);
    expect(listRes.body.some((entry) => entry.id === createRes.body.id)).toBe(true);

    await auth('delete', `/api/cqc-evidence/partner-feedback/${createRes.body.id}?home=${homeSlug}`).expect(200);
  });

  it('creates, updates, lists, and deletes structured observations', async () => {
    const createRes = await auth('post', `/api/cqc-evidence/observations?home=${homeSlug}`)
      .send({
        quality_statement: 'S1',
        observed_at: '2026-04-10T09:30:00Z',
        title: 'Observed handover learning',
        area: 'Handover',
        observer: 'Deputy Manager',
        notes: 'Team discussed previous incidents and learning points.',
        actions: 'Repeat in weekly handover.',
        evidence_owner: 'Deputy Manager',
        review_due: '2026-07-12',
      })
      .expect(201);

    const updateRes = await auth('put', `/api/cqc-evidence/observations/${createRes.body.id}?home=${homeSlug}`)
      .send({
        notes: 'Team discussed previous incidents, learning points, and escalation themes.',
        _version: createRes.body.version,
      })
      .expect(200);

    expect(updateRes.body.version).toBe(2);

    const listRes = await auth('get', `/api/cqc-evidence/observations?home=${homeSlug}`).expect(200);
    expect(listRes.body.some((entry) => entry.id === createRes.body.id)).toBe(true);

    await auth('delete', `/api/cqc-evidence/observations/${createRes.body.id}?home=${homeSlug}`).expect(200);
  });
});
