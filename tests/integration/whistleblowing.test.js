/**
 * Integration tests for Whistleblowing module.
 *
 * Validates: CRUD, optimistic locking, pagination, cross-home isolation,
 * soft delete, anonymous concern handling, boolean fields.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app } from '../../server.js';
import { pool } from '../../db.js';
import * as whistleblowingRepo from '../../repositories/whistleblowingRepo.js';

let homeA, homeB;
const ids = [];
const MANAGER_USERNAME = 'wbl-test-manager';
const TRAINING_USERNAME = 'wbl-test-training';
const PASSWORD = 'WhistleblowingTest1!';
let managerToken;
let trainingToken;

beforeAll(async () => {
  await pool.query(`DELETE FROM whistleblowing_concerns WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'wbl-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM audit_log WHERE home_slug LIKE 'wbl-test-%'`).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username IN ($1, $2)`, [MANAGER_USERNAME, TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username IN ($1, $2)`, [MANAGER_USERNAME, TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username IN ($1, $2)`, [MANAGER_USERNAME, TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'wbl-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('wbl-test-a', 'WBL Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('wbl-test-b', 'WBL Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;

  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Whistleblowing Manager', 'test-setup')`,
    [MANAGER_USERNAME, hash]
  );
  await pool.query(
    `INSERT INTO users (username, password_hash, role, active, display_name, created_by)
     VALUES ($1, $2, 'viewer', true, 'Whistleblowing Training Lead', 'test-setup')`,
    [TRAINING_USERNAME, hash]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'home_manager', 'test-setup')`,
    [MANAGER_USERNAME, homeA]
  );
  await pool.query(
    `INSERT INTO user_home_roles (username, home_id, role_id, granted_by)
     VALUES ($1, $2, 'training_lead', 'test-setup')`,
    [TRAINING_USERNAME, homeA]
  );

  const managerLogin = await request(app)
    .post('/api/login')
    .send({ username: MANAGER_USERNAME, password: PASSWORD })
    .expect(200);
  managerToken = managerLogin.body.token;

  const trainingLogin = await request(app)
    .post('/api/login')
    .send({ username: TRAINING_USERNAME, password: PASSWORD })
    .expect(200);
  trainingToken = trainingLogin.body.token;
});

afterAll(async () => {
  for (const id of ids) {
    await pool.query('DELETE FROM whistleblowing_concerns WHERE id = $1', [id]).catch(() => {});
  }
  await pool.query(`DELETE FROM audit_log WHERE home_slug LIKE 'wbl-test-%'`).catch(() => {});
  await pool.query(`DELETE FROM user_home_roles WHERE username IN ($1, $2)`, [MANAGER_USERNAME, TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM token_denylist WHERE username IN ($1, $2)`, [MANAGER_USERNAME, TRAINING_USERNAME]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE username IN ($1, $2)`, [MANAGER_USERNAME, TRAINING_USERNAME]).catch(() => {});
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Create & Read ────────────────────────────────────────────────────────────

describe('Whistleblowing: create and read', () => {
  let concernId;

  it('creates a concern with version=1', async () => {
    const created = await whistleblowingRepo.upsert(homeA, {
      date_raised: '2026-02-10',
      raised_by_role: 'Senior Carer',
      anonymous: false,
      category: 'safety',
      description: 'Unsafe manual handling practice observed',
      severity: 'high',
      status: 'open',
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    concernId = created.id;
    ids.push(concernId);

    expect(created.version).toBe(1);
    expect(created.date_raised).toBe('2026-02-10');
    expect(created.raised_by_role).toBe('Senior Carer');
    expect(created.anonymous).toBe(false);
    expect(created.category).toBe('safety');
    expect(created.severity).toBe('high');
  });

  it('reads by id', async () => {
    const found = await whistleblowingRepo.findById(concernId, homeA);
    expect(found).not.toBeNull();
    expect(found.id).toBe(concernId);
    expect(found.description).toBe('Unsafe manual handling practice observed');
  });

  it('blocks cross-home read', async () => {
    const found = await whistleblowingRepo.findById(concernId, homeB);
    expect(found).toBeNull();
  });
});

// HTTP route controls protect PIDA-sensitive concerns from broad governance readers.
describe('Whistleblowing: HTTP RBAC and route redaction', () => {
  it('blocks governance read-only roles from listing whistleblowing concerns', async () => {
    const created = await request(app)
      .post('/api/whistleblowing?home=wbl-test-a')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        date_raised: '2026-04-12',
        raised_by_role: 'Night Carer',
        anonymous: false,
        category: 'safety',
        description: 'Named reporter raised a safety concern',
        severity: 'high',
        status: 'registered',
      })
      .expect(201);
    ids.push(created.body.id);

    await request(app)
      .get('/api/whistleblowing?home=wbl-test-a')
      .set('Authorization', `Bearer ${trainingToken}`)
      .expect(403);

    const managerList = await request(app)
      .get('/api/whistleblowing?home=wbl-test-a')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    expect(managerList.body.concerns.some(c => c.id === created.body.id)).toBe(true);
  });

  it('strips reporter role from anonymous route responses', async () => {
    const created = await request(app)
      .post('/api/whistleblowing?home=wbl-test-a')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        date_raised: '2026-04-13',
        raised_by_role: 'Senior Carer',
        anonymous: true,
        category: 'bullying',
        description: 'Anonymous concern details',
        severity: 'medium',
        status: 'registered',
      })
      .expect(201);
    ids.push(created.body.id);

    expect(created.body.raised_by_role).toBeUndefined();

    const listed = await request(app)
      .get('/api/whistleblowing?home=wbl-test-a')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    const concern = listed.body.concerns.find(c => c.id === created.body.id);
    expect(concern).toBeTruthy();
    expect(concern.raised_by_role).toBeUndefined();
  });
});

// ── Anonymous Concerns ──────────────────────────────────────────────────────

describe('Whistleblowing: anonymous concerns', () => {
  let anonId;

  it('stores anonymous concern with raised_by_role at repo level', async () => {
    const created = await whistleblowingRepo.upsert(homeA, {
      date_raised: '2026-02-15',
      raised_by_role: 'Night Carer',
      anonymous: true,
      category: 'bullying',
      description: 'Witnessed bullying behaviour from a colleague',
      severity: 'medium',
    });

    anonId = created.id;
    ids.push(anonId);

    // Repo stores raised_by_role — route strips it from responses
    expect(created.anonymous).toBe(true);
    expect(created.raised_by_role).toBe('Night Carer');
    expect(created.category).toBe('bullying');
  });

  it('stores reporter_protected and protection_details', async () => {
    const created = await whistleblowingRepo.upsert(homeA, {
      date_raised: '2026-01-20',
      anonymous: true,
      category: 'malpractice',
      reporter_protected: true,
      protection_details: 'Reporter notified of whistleblower protections under PIDA 1998',
    });

    ids.push(created.id);

    expect(created.reporter_protected).toBe(true);
    expect(created.protection_details).toContain('PIDA 1998');
  });
});

// ── Investigation & Resolution Fields ───────────────────────────────────────

describe('Whistleblowing: investigation lifecycle', () => {
  let concernId;

  it('stores full investigation and resolution data', async () => {
    const created = await whistleblowingRepo.upsert(homeA, {
      date_raised: '2026-01-05',
      category: 'compliance',
      severity: 'urgent',
      status: 'resolved',
      acknowledgement_date: '2026-01-06',
      investigator: 'Jane Manager',
      investigation_start_date: '2026-01-07',
      findings: 'Confirmed non-compliance with medication protocols',
      outcome: 'disciplinary',
      outcome_details: 'Staff member received formal written warning',
      follow_up_date: '2026-02-07',
      follow_up_completed: true,
      resolution_date: '2026-01-20',
      lessons_learned: 'Additional medication training required for all night staff',
    });

    concernId = created.id;
    ids.push(concernId);

    expect(created.acknowledgement_date).toBe('2026-01-06');
    expect(created.investigator).toBe('Jane Manager');
    expect(created.investigation_start_date).toBe('2026-01-07');
    expect(created.findings).toContain('medication protocols');
    expect(created.outcome).toBe('disciplinary');
    expect(created.follow_up_completed).toBe(true);
    expect(created.resolution_date).toBe('2026-01-20');
    expect(created.lessons_learned).toContain('night staff');
  });
});

// ── Optimistic Locking ───────────────────────────────────────────────────────

describe('Whistleblowing: optimistic locking', () => {
  let concernId;

  beforeAll(async () => {
    const created = await whistleblowingRepo.upsert(homeA, {
      date_raised: '2026-03-01',
      category: 'other',
      status: 'open',
    });
    concernId = created.id;
    ids.push(concernId);
  });

  it('increments version on update', async () => {
    const updated = await whistleblowingRepo.update(concernId, homeA,
      { status: 'investigating' }, 1
    );
    expect(updated).not.toBeNull();
    expect(updated.version).toBe(2);
    expect(updated.status).toBe('investigating');
  });

  it('returns null on stale version', async () => {
    const result = await whistleblowingRepo.update(concernId, homeA,
      { status: 'resolved' }, 1
    );
    expect(result).toBeNull();
  });

  it('bumps version when upsert touches an existing concern', async () => {
    const created = await whistleblowingRepo.upsert(homeA, {
      date_raised: '2026-03-05',
      category: 'other',
      status: 'registered',
    });
    ids.push(created.id);

    const updated = await whistleblowingRepo.upsert(homeA, {
      id: created.id,
      date_raised: '2026-03-05',
      category: 'safety',
      status: 'registered',
    });

    expect(updated.version).toBe(created.version + 1);
    expect(updated.category).toBe('safety');
  });
});

// ── Pagination ───────────────────────────────────────────────────────────────

describe('Whistleblowing: pagination', () => {
  it('returns { rows, total }', async () => {
    const result = await whistleblowingRepo.findByHome(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for other home', async () => {
    const result = await whistleblowingRepo.findByHome(homeB);
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ── Soft Delete ──────────────────────────────────────────────────────────────

describe('Whistleblowing: soft delete', () => {
  let concernId;

  beforeAll(async () => {
    const created = await whistleblowingRepo.upsert(homeA, {
      date_raised: '2026-04-01',
      category: 'safety',
    });
    concernId = created.id;
    ids.push(concernId);
  });

  it('soft-deletes and excludes from queries', async () => {
    const deleted = await whistleblowingRepo.softDelete(concernId, homeA);
    expect(deleted).toBe(true);

    const byId = await whistleblowingRepo.findById(concernId, homeA);
    expect(byId).toBeNull();
  });
});

describe('Whistleblowing: sync safety', () => {
  it('does not soft-delete concerns omitted from a partial sync payload', async () => {
    const kept = await whistleblowingRepo.upsert(homeA, {
      date_raised: '2026-04-10',
      category: 'safety',
      severity: 'high',
      status: 'registered',
    });
    const omitted = await whistleblowingRepo.upsert(homeA, {
      date_raised: '2026-04-11',
      category: 'compliance',
      severity: 'medium',
      status: 'registered',
    });
    ids.push(kept.id, omitted.id);

    await whistleblowingRepo.sync(homeA, [{
      ...kept,
      category: 'malpractice',
    }]);

    expect(await whistleblowingRepo.findById(kept.id, homeA)).not.toBeNull();
    expect(await whistleblowingRepo.findById(omitted.id, homeA)).not.toBeNull();
  });
});
