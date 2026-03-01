/**
 * Integration tests for Grievance cases and Grievance Actions (nested child routes).
 *
 * Tests the unique pattern: parent grievance + child actions (FK relationship).
 * Validates CRUD, locking, home isolation, and parent-child cascade.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as hrRepo from '../../repositories/hrRepo.js';

let homeA, homeB;
const createdIds = [];
const staffIds = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM hr_grievance_actions WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'grv-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM hr_grievance_cases WHERE staff_id LIKE 'grv-test-%'`).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE id LIKE 'grv-test-%'`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'grv-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('grv-test-a', 'Grievance Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('grv-test-b', 'Grievance Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;

  for (const sid of ['grv-test-01', 'grv-test-02', 'grv-test-03']) {
    await pool.query(
      `INSERT INTO staff (id, home_id, name, role, team, skill, hourly_rate, active, wtr_opt_out, al_carryover)
       VALUES ($1, $2, $3, 'Carer', 'Day A', 1, 12.50, true, false, 0)`,
      [sid, homeA, `Staff ${sid}`]
    );
    staffIds.push(sid);
  }
});

afterAll(async () => {
  for (const id of createdIds) {
    await pool.query('DELETE FROM hr_grievance_actions WHERE grievance_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM hr_grievance_cases WHERE id = $1', [id]).catch(() => {});
  }
  for (const sid of staffIds) {
    await pool.query('DELETE FROM staff WHERE id = $1', [sid]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Grievance CRUD ──────────────────────────────────────────────────────────

describe('Grievance: create and read', () => {
  let caseId;

  it('creates a grievance with version=1', async () => {
    const created = await hrRepo.createGrievance(homeA, {
      staff_id: 'grv-test-01',
      date_raised: '2026-02-01',
      category: 'bullying',
      subject_summary: 'Staff member reports workplace bullying',
      desired_outcome: 'Investigation and resolution',
      status: 'open',
      created_by: 'test-runner',
    });

    caseId = created.id;
    createdIds.push(caseId);

    expect(created).not.toBeNull();
    expect(created.version).toBe(1);
    expect(created.staff_id).toBe('grv-test-01');
    expect(created.category).toBe('bullying');
    expect(created.subject_summary).toBe('Staff member reports workplace bullying');
    expect(created.status).toBe('open');
    expect(created.home_id).toBe(homeA);
  });

  it('reads by id', async () => {
    const found = await hrRepo.findGrievanceById(caseId, homeA);
    expect(found).not.toBeNull();
    expect(found.id).toBe(caseId);
    expect(found.version).toBe(1);
  });

  it('blocks cross-home read', async () => {
    const found = await hrRepo.findGrievanceById(caseId, homeB);
    expect(found).toBeNull();
  });
});

// ── Grievance Locking ───────────────────────────────────────────────────────

describe('Grievance: optimistic locking', () => {
  let caseId;

  beforeAll(async () => {
    const created = await hrRepo.createGrievance(homeA, {
      staff_id: 'grv-test-02',
      date_raised: '2026-02-05',
      category: 'discrimination',
      subject_summary: 'Locking test grievance',
      status: 'open',
      created_by: 'test-runner',
    });
    caseId = created.id;
    createdIds.push(caseId);
  });

  it('increments version on update', async () => {
    const updated = await hrRepo.updateGrievance(caseId, homeA,
      { status: 'investigating', investigation_officer: 'Jane Manager' },
      null, 1
    );
    expect(updated.version).toBe(2);
    expect(updated.status).toBe('investigating');
    expect(updated.investigation_officer).toBe('Jane Manager');
  });

  it('returns null on stale version', async () => {
    const result = await hrRepo.updateGrievance(caseId, homeA,
      { status: 'hearing_scheduled' }, null, 1
    );
    expect(result).toBeNull();
  });

  it('data unchanged after conflict', async () => {
    const current = await hrRepo.findGrievanceById(caseId, homeA);
    expect(current.status).toBe('investigating');
    expect(current.version).toBe(2);
  });
});

// ── Grievance Pagination + Filters ──────────────────────────────────────────

describe('Grievance: pagination and filters', () => {
  beforeAll(async () => {
    for (let i = 0; i < 3; i++) {
      const created = await hrRepo.createGrievance(homeA, {
        staff_id: 'grv-test-03',
        date_raised: `2026-03-0${i + 1}`,
        category: 'working_conditions',
        subject_summary: `Pagination grievance ${i}`,
        status: i === 0 ? 'closed' : 'open',
        created_by: 'test-runner',
      });
      createdIds.push(created.id);
    }
  });

  it('returns { rows, total }', async () => {
    const result = await hrRepo.findGrievance(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(5); // 2 earlier + 3 here
  });

  it('filters by staffId', async () => {
    const result = await hrRepo.findGrievance(homeA, { staffId: 'grv-test-03' });
    expect(result.total).toBe(3);
    expect(result.rows.every(r => r.staff_id === 'grv-test-03')).toBe(true);
  });

  it('filters by status', async () => {
    const result = await hrRepo.findGrievance(homeA, { status: 'closed' });
    expect(result.rows.every(r => r.status === 'closed')).toBe(true);
  });

  it('respects limit/offset', async () => {
    const page1 = await hrRepo.findGrievance(homeA, {}, null, { limit: 2, offset: 0 });
    const page2 = await hrRepo.findGrievance(homeA, {}, null, { limit: 2, offset: 2 });
    expect(page1.rows).toHaveLength(2);
    const ids1 = page1.rows.map(r => r.id);
    const ids2 = page2.rows.map(r => r.id);
    expect(ids1.every(id => !ids2.includes(id))).toBe(true);
  });

  it('returns empty for other home', async () => {
    const result = await hrRepo.findGrievance(homeB);
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ── Grievance Actions (Child Routes) ────────────────────────────────────────

describe('Grievance Actions: nested CRUD', () => {
  let grievanceId;
  let actionId;

  beforeAll(async () => {
    const grv = await hrRepo.createGrievance(homeA, {
      staff_id: 'grv-test-01',
      date_raised: '2026-04-01',
      category: 'pay',
      subject_summary: 'Actions parent grievance',
      status: 'investigating',
      created_by: 'test-runner',
    });
    grievanceId = grv.id;
    createdIds.push(grievanceId);
  });

  it('creates an action linked to grievance', async () => {
    const action = await hrRepo.createGrievanceAction(grievanceId, homeA, {
      description: 'Interview witnesses',
      responsible: 'HR Manager',
      due_date: '2026-04-15',
      status: 'pending',
    });

    actionId = action.id;
    expect(action).not.toBeNull();
    expect(action.grievance_id).toBe(grievanceId);
    expect(action.home_id).toBe(homeA);
    expect(action.description).toBe('Interview witnesses');
    expect(action.status).toBe('pending');
  });

  it('lists actions for a grievance', async () => {
    // Add a second action
    await hrRepo.createGrievanceAction(grievanceId, homeA, {
      description: 'Review CCTV',
      responsible: 'Security',
      due_date: '2026-04-20',
    });

    const actions = await hrRepo.findGrievanceActions(grievanceId, homeA);
    expect(actions).toHaveLength(2);
    expect(actions[0].grievance_id).toBe(grievanceId);
    expect(actions[1].grievance_id).toBe(grievanceId);
  });

  it('updates an action', async () => {
    const updated = await hrRepo.updateGrievanceAction(actionId, homeA, {
      status: 'completed',
      completed_date: '2026-04-10',
    });

    expect(updated.status).toBe('completed');
    expect(updated.completed_date).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('actions isolated to home', async () => {
    const actions = await hrRepo.findGrievanceActions(grievanceId, homeB);
    expect(actions).toHaveLength(0);
  });

  it('action update blocked for wrong home', async () => {
    const updated = await hrRepo.updateGrievanceAction(actionId, homeB, {
      status: 'pending',
    });
    // Should return undefined/null since no row matches
    expect(updated).toBeFalsy();
  });
});

// ── Soft Delete ─────────────────────────────────────────────────────────────

describe('Grievance: soft delete', () => {
  let caseId;

  beforeAll(async () => {
    const created = await hrRepo.createGrievance(homeA, {
      staff_id: 'grv-test-01',
      date_raised: '2026-05-01',
      category: 'other',
      subject_summary: 'Soft delete test',
      status: 'open',
      created_by: 'test-runner',
    });
    caseId = created.id;
    createdIds.push(caseId);
  });

  it('soft-deleted grievance excluded from queries', async () => {
    await pool.query(
      'UPDATE hr_grievance_cases SET deleted_at = NOW() WHERE id = $1',
      [caseId]
    );

    const byId = await hrRepo.findGrievanceById(caseId, homeA);
    expect(byId).toBeNull();

    const list = await hrRepo.findGrievance(homeA, { staffId: 'grv-test-01' });
    const found = list.rows.find(r => r.id === caseId);
    expect(found).toBeUndefined();
  });
});
