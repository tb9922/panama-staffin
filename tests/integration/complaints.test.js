/**
 * Integration tests for Complaints and Surveys module.
 *
 * Validates: CRUD for complaints and surveys, optimistic locking,
 * resolution workflow, satisfaction scoring, home isolation, soft delete.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as complaintRepo from '../../repositories/complaintRepo.js';
import * as surveyRepo from '../../repositories/complaintSurveyRepo.js';

let homeA, homeB;
const complaintIds = [];
const surveyIds = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM complaint_surveys WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'cmp-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM complaints WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'cmp-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'cmp-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('cmp-test-a', 'Complaints Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('cmp-test-b', 'Complaints Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;
});

afterAll(async () => {
  for (const id of surveyIds) {
    await pool.query('DELETE FROM complaint_surveys WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of complaintIds) {
    await pool.query('DELETE FROM complaints WHERE id = $1', [id]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Complaints CRUD ────────────────────────────────────────────────────────

describe('Complaints: create and read', () => {
  let cmpId;

  it('creates a complaint with version=1', async () => {
    const created = await complaintRepo.upsert(homeA, {
      date: '2026-01-15',
      raised_by: 'family',
      raised_by_name: 'Mrs Jones',
      category: 'care-quality',
      title: 'Medication administered late',
      description: 'Mother reports medication was given 2 hours late on 14 Jan',
      status: 'open',
      reported_by: 'admin',
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    cmpId = created.id;
    complaintIds.push(cmpId);

    expect(created.version).toBe(1);
    expect(created.title).toBe('Medication administered late');
    expect(created.status).toBe('open');
    expect(created.category).toBe('care-quality');
  });

  it('reads by id', async () => {
    const found = await complaintRepo.findById(cmpId, homeA);
    expect(found).not.toBeNull();
    expect(found.id).toBe(cmpId);
    expect(found.raised_by_name).toBe('Mrs Jones');
  });

  it('blocks cross-home read', async () => {
    const found = await complaintRepo.findById(cmpId, homeB);
    expect(found).toBeNull();
  });
});

// ── Complaint Resolution Workflow ──────────────────────────────────────────

describe('Complaints: resolution workflow', () => {
  let cmpId;

  beforeAll(async () => {
    const created = await complaintRepo.upsert(homeA, {
      date: '2026-02-01',
      title: 'Staffing levels too low on weekends',
      category: 'staffing',
      status: 'open',
      reported_by: 'admin',
    });
    cmpId = created.id;
    complaintIds.push(cmpId);
  });

  it('acknowledges complaint', async () => {
    const found = await complaintRepo.findById(cmpId, homeA);
    const updated = await complaintRepo.update(cmpId, homeA, {
      status: 'acknowledged',
      acknowledged_date: '2026-02-02',
      response_deadline: '2026-02-22',
    }, found.version);

    expect(updated).not.toBeNull();
    expect(updated.status).toBe('acknowledged');
  });

  it('assigns investigation', async () => {
    const found = await complaintRepo.findById(cmpId, homeA);
    const updated = await complaintRepo.update(cmpId, homeA, {
      status: 'investigating',
      investigator: 'Manager Smith',
      investigation_notes: 'Reviewing rotas for January weekends',
    }, found.version);

    expect(updated).not.toBeNull();
    expect(updated.status).toBe('investigating');
    expect(updated.investigator).toBe('Manager Smith');
  });

  it('resolves with root cause and improvements', async () => {
    const found = await complaintRepo.findById(cmpId, homeA);
    const updated = await complaintRepo.update(cmpId, homeA, {
      status: 'resolved',
      resolution: 'Additional weekend cover arranged via agency pool',
      resolution_date: '2026-02-15',
      outcome_shared: true,
      root_cause: 'Weekend float cover insufficient',
      improvements: 'Increased weekend minimum staffing by 1 head',
      lessons_learned: 'Review staffing minimums quarterly',
    }, found.version);

    expect(updated).not.toBeNull();
    expect(updated.status).toBe('resolved');
    expect(updated.resolution).toBe('Additional weekend cover arranged via agency pool');
    expect(updated.outcome_shared).toBe(true);
    expect(updated.root_cause).toBe('Weekend float cover insufficient');
  });
});

// ── Optimistic Locking ─────────────────────────────────────────────────────

describe('Complaints: optimistic locking', () => {
  let cmpId;

  beforeAll(async () => {
    const created = await complaintRepo.upsert(homeA, {
      date: '2026-03-01',
      title: 'Test locking',
      status: 'open',
      reported_by: 'admin',
    });
    cmpId = created.id;
    complaintIds.push(cmpId);
  });

  it('increments version on update', async () => {
    const updated = await complaintRepo.update(cmpId, homeA,
      { status: 'acknowledged' }, 1
    );
    expect(updated).not.toBeNull();
    expect(updated.version).toBe(2);
  });

  it('returns null on stale version', async () => {
    const result = await complaintRepo.update(cmpId, homeA,
      { status: 'investigating' }, 1
    );
    expect(result).toBeNull();
  });
});

// ── Pagination ─────────────────────────────────────────────────────────────

describe('Complaints: pagination', () => {
  it('returns { rows, total }', async () => {
    const result = await complaintRepo.findByHome(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for other home', async () => {
    const result = await complaintRepo.findByHome(homeB);
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ── Soft Delete ────────────────────────────────────────────────────────────

describe('Complaints: soft delete', () => {
  let cmpId;

  beforeAll(async () => {
    const created = await complaintRepo.upsert(homeA, {
      date: '2026-04-01',
      title: 'Test soft delete',
      status: 'open',
      reported_by: 'admin',
    });
    cmpId = created.id;
    complaintIds.push(cmpId);
  });

  it('soft-deletes and excludes from queries', async () => {
    const deleted = await complaintRepo.softDelete(cmpId, homeA);
    expect(deleted).toBe(true);

    const byId = await complaintRepo.findById(cmpId, homeA);
    expect(byId).toBeNull();
  });
});

// ── Surveys CRUD ───────────────────────────────────────────────────────────

describe('Surveys: create and read', () => {
  let srvId;

  it('creates a survey with version=1', async () => {
    const created = await surveyRepo.upsert(homeA, {
      type: 'families',
      date: '2026-01-20',
      title: 'Q1 Family Satisfaction Survey',
      total_sent: 40,
      responses: 28,
      overall_satisfaction: 4.2,
      area_scores: { care: 4.5, communication: 3.8, facilities: 4.0 },
      key_feedback: 'Generally positive, communication needs work',
      actions: 'Schedule family meetings monthly',
      conducted_by: 'Manager Smith',
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    srvId = created.id;
    surveyIds.push(srvId);

    expect(created.version).toBe(1);
    expect(created.title).toBe('Q1 Family Satisfaction Survey');
    expect(created.total_sent).toBe(40);
    expect(created.responses).toBe(28);
    expect(created.overall_satisfaction).toBe(4.2);
  });

  it('reads survey by id', async () => {
    const found = await surveyRepo.findById(srvId, homeA);
    expect(found).not.toBeNull();
    expect(found.type).toBe('families');
    expect(found.conducted_by).toBe('Manager Smith');
  });

  it('stores and retrieves area_scores as object', async () => {
    const found = await surveyRepo.findById(srvId, homeA);
    expect(typeof found.area_scores).toBe('object');
    expect(found.area_scores.care).toBe(4.5);
    expect(found.area_scores.communication).toBe(3.8);
  });

  it('blocks cross-home survey read', async () => {
    const found = await surveyRepo.findById(srvId, homeB);
    expect(found).toBeNull();
  });
});

// ── Survey Optimistic Locking ──────────────────────────────────────────────

describe('Surveys: optimistic locking', () => {
  let srvId;

  beforeAll(async () => {
    const created = await surveyRepo.upsert(homeA, {
      type: 'residents',
      date: '2026-02-20',
      title: 'Test survey locking',
      total_sent: 30,
      responses: 20,
      overall_satisfaction: 3.5,
    });
    srvId = created.id;
    surveyIds.push(srvId);
  });

  it('increments version on update', async () => {
    const updated = await surveyRepo.update(srvId, homeA,
      { overall_satisfaction: 4.0 }, 1
    );
    expect(updated).not.toBeNull();
    expect(updated.version).toBe(2);
    expect(updated.overall_satisfaction).toBe(4.0);
  });

  it('returns null on stale version', async () => {
    const result = await surveyRepo.update(srvId, homeA,
      { overall_satisfaction: 2.0 }, 1
    );
    expect(result).toBeNull();
  });
});

// ── Survey Pagination ──────────────────────────────────────────────────────

describe('Surveys: pagination', () => {
  it('returns { rows, total }', async () => {
    const result = await surveyRepo.findByHome(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for other home', async () => {
    const result = await surveyRepo.findByHome(homeB);
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ── Survey Soft Delete ─────────────────────────────────────────────────────

describe('Surveys: soft delete', () => {
  let srvId;

  beforeAll(async () => {
    const created = await surveyRepo.upsert(homeA, {
      type: 'staff',
      date: '2026-04-15',
      title: 'Test survey delete',
      total_sent: 10,
    });
    srvId = created.id;
    surveyIds.push(srvId);
  });

  it('soft-deletes survey and excludes from queries', async () => {
    const deleted = await surveyRepo.softDelete(srvId, homeA);
    expect(deleted).toBe(true);

    const byId = await surveyRepo.findById(srvId, homeA);
    expect(byId).toBeNull();
  });
});
