import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { pool } from '../../db.js';
import { app } from '../../server.js';
import * as cqcEvidenceLinksRepo from '../../repositories/cqcEvidenceLinksRepo.js';

const PREFIX = 'cqc-links';
const HOME_A = `${PREFIX}-home-a`;
const HOME_B = `${PREFIX}-home-b`;
const USERNAME = `${PREFIX}-manager`;
const PASSWORD = 'CqcLinks1!';

let homeAId;
let homeBId;
let token;

beforeAll(async () => {
  await pool.query(`DELETE FROM cqc_evidence_links WHERE home_id IN (SELECT id FROM homes WHERE slug IN ($1, $2))`, [HOME_A, HOME_B]).catch(() => {});
  await pool.query('DELETE FROM user_home_roles WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM token_denylist WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM users WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM homes WHERE slug IN ($1, $2)', [HOME_A, HOME_B]).catch(() => {});

  const { rows: homes } = await pool.query(
    `INSERT INTO homes (slug, name)
     VALUES ($1, 'CQC Links Home A'), ($2, 'CQC Links Home B')
     RETURNING id, slug`,
    [HOME_A, HOME_B]
  );
  homeAId = homes.find((row) => row.slug === HOME_A).id;
  homeBId = homes.find((row) => row.slug === HOME_B).id;

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'CQC Links Manager', 'test-setup')`,
    [USERNAME, passwordHash]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'home_manager', 'test-setup'),
            ($1, $3, 'home_manager', 'test-setup')`,
    [USERNAME, homeAId, homeBId]
  );

  const loginRes = await request(app)
    .post('/api/login')
    .send({ username: USERNAME, password: PASSWORD })
    .expect(200);
  token = loginRes.body.token;
}, 15000);

afterAll(async () => {
  if (homeAId) await pool.query('DELETE FROM cqc_evidence_links WHERE home_id = $1', [homeAId]).catch(() => {});
  if (homeBId) await pool.query('DELETE FROM cqc_evidence_links WHERE home_id = $1', [homeBId]).catch(() => {});
  await pool.query('DELETE FROM user_home_roles WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM token_denylist WHERE username = $1', [USERNAME]).catch(() => {});
  await pool.query('DELETE FROM users WHERE username = $1', [USERNAME]).catch(() => {});
  if (homeAId) await pool.query('DELETE FROM homes WHERE id = $1', [homeAId]).catch(() => {});
  if (homeBId) await pool.query('DELETE FROM homes WHERE id = $1', [homeBId]).catch(() => {});
});

function auth(method, path) {
  return request(app)[method](path).set('Authorization', `Bearer ${token}`);
}

describe('cqc evidence links', () => {
  it('creates a manual link and returns the shaped row', async () => {
    const res = await auth('post', `/api/cqc-evidence-links?home=${HOME_A}`)
      .send({
        source_module: 'incident',
        source_id: 'inc-001',
        quality_statement: 'S1',
        evidence_category: 'processes',
        rationale: 'Manual review',
        source_recorded_at: '2026-04-10',
      })
      .expect(201);

    expect(res.body.sourceModule).toBe('incident');
    expect(res.body.sourceId).toBe('inc-001');
    expect(res.body.qualityStatement).toBe('S1');
    expect(res.body.sourceRecordedAt).toBe('2026-04-10T00:00:00.000Z');
    expect(res.body.requiresReview).toBe(false);
  });

  it('bulk creates links while ignoring duplicates', async () => {
    const res = await auth('post', `/api/cqc-evidence-links/bulk?home=${HOME_A}`)
      .send({
        links: [
          {
            source_module: 'incident',
            source_id: 'inc-001',
            quality_statement: 'S1',
            evidence_category: 'processes',
            rationale: 'Duplicate should collapse',
          },
          {
            source_module: 'incident',
            source_id: 'inc-001',
            quality_statement: 'S1',
            evidence_category: 'processes',
            rationale: 'Duplicate should collapse',
          },
          {
            source_module: 'incident',
            source_id: 'inc-001',
            quality_statement: 'S4',
            evidence_category: 'processes',
            rationale: 'Risk link',
            source_recorded_at: '2026-04-11',
          },
        ],
      })
      .expect(201);

    expect(res.body.links).toHaveLength(2);
  });

  it('finds statement links within a date range and keeps tenants isolated', async () => {
    await cqcEvidenceLinksRepo.createLink(homeAId, {
      source_module: 'complaint',
      source_id: 'cmp-001',
      quality_statement: 'R4',
      evidence_category: 'peoples_experience',
      rationale: 'In-range',
      linked_by: 'system',
      auto_linked: true,
      requires_review: true,
      source_recorded_at: '2026-04-09',
    });
    await cqcEvidenceLinksRepo.createLink(homeBId, {
      source_module: 'complaint',
      source_id: 'cmp-b',
      quality_statement: 'R4',
      evidence_category: 'peoples_experience',
      rationale: 'Other tenant',
      linked_by: 'system',
      auto_linked: true,
      requires_review: true,
      source_recorded_at: '2026-04-09',
    });

    const res = await auth('get', `/api/cqc-evidence-links?home=${HOME_A}&statement=R4&dateFrom=2026-04-01&dateTo=2026-04-30`)
      .expect(200);

    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].sourceId).toBe('cmp-001');
    expect(res.body.rows.some((row) => row.sourceId === 'cmp-b')).toBe(false);
  });

  it('finds all links for a source record and returns grouped counts', async () => {
    const bySource = await auth('get', `/api/cqc-evidence-links/source/incident/inc-001?home=${HOME_A}`).expect(200);
    expect(bySource.body.map((row) => row.qualityStatement).sort()).toEqual(['S1', 'S4']);

    const counts = await auth('get', `/api/cqc-evidence-links/counts?home=${HOME_A}`).expect(200);
    const s1 = counts.body.find((row) => row.qualityStatement === 'S1' && row.evidenceCategory === 'processes');
    expect(s1).toBeTruthy();
    expect(s1.count).toBeGreaterThanOrEqual(1);
  });

  it('supports optimistic locking, confirm, and soft delete', async () => {
    const created = await cqcEvidenceLinksRepo.createLink(homeAId, {
      source_module: 'maintenance',
      source_id: 'mnt-001',
      quality_statement: 'S5',
      evidence_category: 'processes',
      rationale: 'Needs review',
      linked_by: 'system',
      auto_linked: true,
      requires_review: true,
      source_recorded_at: '2026-04-08',
    });

    await auth('put', `/api/cqc-evidence-links/${created.id}?home=${HOME_A}`)
      .send({ rationale: 'Manager checked it', _version: 0 })
      .expect(409);

    const updated = await auth('put', `/api/cqc-evidence-links/${created.id}?home=${HOME_A}`)
      .send({ rationale: 'Manager checked it', _version: created.version })
      .expect(200);
    expect(updated.body.version).toBe(created.version + 1);

    const confirmed = await auth('post', `/api/cqc-evidence-links/${created.id}/confirm?home=${HOME_A}`)
      .expect(200);
    expect(confirmed.body.requiresReview).toBe(false);
    expect(confirmed.body.linkedBy).toBe(USERNAME);

    await auth('delete', `/api/cqc-evidence-links/${created.id}?home=${HOME_A}`).expect(200);
    const afterDelete = await cqcEvidenceLinksRepo.findById(created.id, homeAId);
    expect(afterDelete).toBeNull();
  });
});
