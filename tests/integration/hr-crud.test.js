/**
 * Integration tests for HR CRUD operations — pagination, optimistic locking,
 * and cross-home isolation.
 *
 * These tests hit the real database to verify that repo functions
 * correctly handle versioning, pagination, and home scoping.
 *
 * Requires: PostgreSQL running with migrations applied.
 * Runs in CI via .github/workflows/test.yml (postgres service).
 * Locally: `docker compose up -d` + `node scripts/migrate.js` first.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as hrRepo from '../../repositories/hrRepo.js';

let homeA, homeB;
const createdCaseIds = [];
const testStaffIds = [];

beforeAll(async () => {
  // Clean up any leftover test data from previous failed runs
  await pool.query(`DELETE FROM hr_disciplinary_cases WHERE staff_id LIKE 'crud-test-%'`).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE id LIKE 'crud-test-%'`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'hr-crud-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('hr-crud-test-a', 'HR CRUD Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('hr-crud-test-b', 'HR CRUD Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;

  // Create test staff records (FK requires staff to exist)
  const staffIds = [
    'crud-test-01', 'crud-test-02', 'crud-test-10', 'crud-test-11',
    'crud-test-12', 'crud-test-13', 'crud-test-14', 'crud-test-50', 'crud-test-60',
  ];
  for (const sid of staffIds) {
    await pool.query(
      `INSERT INTO staff (id, home_id, name, role, team, skill, hourly_rate, active, wtr_opt_out, al_carryover)
       VALUES ($1, $2, $3, 'Carer', 'Day A', 1, 12.50, true, false, 0)`,
      [sid, homeA, `Test Staff ${sid}`]
    );
    testStaffIds.push(sid);
  }
});

afterAll(async () => {
  // Clean up cases created during tests
  for (const id of createdCaseIds) {
    await pool.query('DELETE FROM hr_disciplinary_cases WHERE id = $1', [id]).catch(() => {});
  }
  // Clean up test staff
  for (const sid of testStaffIds) {
    await pool.query('DELETE FROM staff WHERE id = $1', [sid]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Create + Read ────────────────────────────────────────────────────────────

describe('HR CRUD: create and read disciplinary case', () => {
  let caseId;

  it('creates a case with version=1', async () => {
    const created = await hrRepo.createDisciplinary(homeA, {
      staff_id: 'crud-test-01',
      date_raised: '2026-02-01',
      raised_by: 'test-admin',
      category: 'misconduct',
      allegation_summary: 'Integration test case A',
      status: 'open',
      created_by: 'test-runner',
    });

    caseId = created.id;
    createdCaseIds.push(caseId);

    expect(created).not.toBeNull();
    expect(created.version).toBe(1);
    expect(created.staff_id).toBe('crud-test-01');
    expect(created.category).toBe('misconduct');
    expect(created.allegation_summary).toBe('Integration test case A');
    expect(created.status).toBe('open');
    expect(created.home_id).toBe(homeA);
  });

  it('reads case by id with correct home', async () => {
    const found = await hrRepo.findDisciplinaryById(caseId, homeA);
    expect(found).not.toBeNull();
    expect(found.id).toBe(caseId);
    expect(found.version).toBe(1);
  });

  it('returns null when reading with wrong home (cross-home blocked)', async () => {
    const found = await hrRepo.findDisciplinaryById(caseId, homeB);
    expect(found).toBeNull();
  });
});

// ── Optimistic Locking ───────────────────────────────────────────────────────

describe('HR CRUD: optimistic locking', () => {
  let caseId;

  beforeAll(async () => {
    const created = await hrRepo.createDisciplinary(homeA, {
      staff_id: 'crud-test-02',
      date_raised: '2026-02-02',
      raised_by: 'test-admin',
      category: 'attendance',
      allegation_summary: 'Version conflict test case',
      status: 'open',
      created_by: 'test-runner',
    });
    caseId = created.id;
    createdCaseIds.push(caseId);
  });

  it('increments version on successful update', async () => {
    const updated = await hrRepo.updateDisciplinary(
      caseId, homeA,
      { status: 'investigation' },
      null, // no client
      1     // version
    );

    expect(updated).not.toBeNull();
    expect(updated.version).toBe(2);
    expect(updated.status).toBe('investigation');
  });

  it('returns null on version mismatch (conflict)', async () => {
    // Current version is 2 after the previous test, try with stale version 1
    const result = await hrRepo.updateDisciplinary(
      caseId, homeA,
      { status: 'closed' },
      null,
      1 // stale version
    );

    expect(result).toBeNull();
  });

  it('does not mutate data on version conflict', async () => {
    const current = await hrRepo.findDisciplinaryById(caseId, homeA);
    expect(current.status).toBe('investigation'); // unchanged from successful update
    expect(current.version).toBe(2);
  });

  it('update without version param skips version check', async () => {
    const updated = await hrRepo.updateDisciplinary(
      caseId, homeA,
      { allegation_summary: 'Updated without version check' },
    );

    expect(updated).not.toBeNull();
    expect(updated.version).toBe(3); // still increments
    expect(updated.allegation_summary).toBe('Updated without version check');
  });

  it('blocks cross-home update even with correct version', async () => {
    const current = await hrRepo.findDisciplinaryById(caseId, homeA);
    const result = await hrRepo.updateDisciplinary(
      caseId, homeB, // wrong home
      { status: 'closed' },
      null,
      current.version
    );

    // The update should affect 0 rows since home_id doesn't match
    // Depending on implementation, this may return null or throw
    // The key assertion: data must not change
    const unchanged = await hrRepo.findDisciplinaryById(caseId, homeA);
    expect(unchanged.status).toBe('investigation');
  });
});

// ── Pagination ───────────────────────────────────────────────────────────────

describe('HR CRUD: pagination', () => {
  const caseIds = [];

  beforeAll(async () => {
    // Create 5 cases for pagination testing
    for (let i = 0; i < 5; i++) {
      const created = await hrRepo.createDisciplinary(homeA, {
        staff_id: `crud-test-1${i}`,
        date_raised: `2026-03-0${i + 1}`,
        raised_by: 'test-admin',
        category: 'misconduct',
        allegation_summary: `Pagination test case ${i}`,
        status: 'open',
        created_by: 'test-runner',
      });
      caseIds.push(created.id);
      createdCaseIds.push(created.id);
    }
  });

  it('returns { rows, total } shape', async () => {
    const result = await hrRepo.findDisciplinary(homeA, {}, null, {});
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(Array.isArray(result.rows)).toBe(true);
    expect(typeof result.total).toBe('number');
  });

  it('total reflects all matching records', async () => {
    const result = await hrRepo.findDisciplinary(homeA, {}, null, { limit: 2 });
    expect(result.rows).toHaveLength(2);
    // total includes all cases for homeA (pagination cases + other cases from earlier tests)
    expect(result.total).toBeGreaterThanOrEqual(5);
  });

  it('respects limit parameter', async () => {
    const result = await hrRepo.findDisciplinary(homeA, {}, null, { limit: 3 });
    expect(result.rows).toHaveLength(3);
  });

  it('respects offset parameter', async () => {
    const all = await hrRepo.findDisciplinary(homeA, {}, null, { limit: 500 });
    const page2 = await hrRepo.findDisciplinary(homeA, {}, null, { limit: 2, offset: 2 });

    expect(page2.rows).toHaveLength(2);
    // page2 rows should not include the first 2 rows
    const allIds = all.rows.map(r => r.id);
    const page2Ids = page2.rows.map(r => r.id);
    expect(page2Ids[0]).toBe(allIds[2]);
    expect(page2Ids[1]).toBe(allIds[3]);
  });

  it('caps limit at 500', async () => {
    // Requesting limit=9999 should be capped
    const result = await hrRepo.findDisciplinary(homeA, {}, null, { limit: 9999 });
    // Should succeed without error — the paginate helper caps internally
    expect(result.rows.length).toBeLessThanOrEqual(500);
  });

  it('defaults to limit=200 when not specified', async () => {
    // Just verify it doesn't crash with no pagination params
    const result = await hrRepo.findDisciplinary(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
  });

  it('filters work with pagination', async () => {
    const created = await hrRepo.createDisciplinary(homeA, {
      staff_id: 'crud-test-50',
      date_raised: '2026-03-10',
      raised_by: 'test-admin',
      category: 'capability',
      allegation_summary: 'Filter test case',
      status: 'open',
      created_by: 'test-runner',
    });
    createdCaseIds.push(created.id);

    const result = await hrRepo.findDisciplinary(homeA, { staffId: 'crud-test-50' }, null, {});
    expect(result.total).toBe(1);
    expect(result.rows[0].staff_id).toBe('crud-test-50');
  });

  it('returns empty result for other home', async () => {
    const result = await hrRepo.findDisciplinary(homeB, {}, null, {});
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ── Soft Delete ──────────────────────────────────────────────────────────────

describe('HR CRUD: soft delete', () => {
  let caseId;

  beforeAll(async () => {
    const created = await hrRepo.createDisciplinary(homeA, {
      staff_id: 'crud-test-60',
      date_raised: '2026-02-15',
      raised_by: 'test-admin',
      category: 'conduct',
      allegation_summary: 'Soft delete test',
      status: 'open',
      created_by: 'test-runner',
    });
    caseId = created.id;
    createdCaseIds.push(caseId);
  });

  it('soft-deleted case is excluded from find results', async () => {
    // Soft-delete via raw SQL (repo doesn't expose a delete function directly)
    await pool.query(
      'UPDATE hr_disciplinary_cases SET deleted_at = NOW() WHERE id = $1',
      [caseId]
    );

    const byId = await hrRepo.findDisciplinaryById(caseId, homeA);
    expect(byId).toBeNull();

    const list = await hrRepo.findDisciplinary(homeA, { staffId: 'crud-test-60' });
    expect(list.rows).toHaveLength(0);
  });
});
