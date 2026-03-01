/**
 * Integration tests for DoLS/LPS and MCA Assessments module.
 *
 * Validates: CRUD for both dols and mca_assessments, optimistic locking,
 * restrictions JSON array, date handling, home isolation, soft delete.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as dolsRepo from '../../repositories/dolsRepo.js';

let homeA, homeB;
const dolsIds = [];
const mcaIds = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM mca_assessments WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'dol-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM dols WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'dol-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'dol-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('dol-test-a', 'DoLS Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('dol-test-b', 'DoLS Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;
});

afterAll(async () => {
  for (const id of mcaIds) {
    await pool.query('DELETE FROM mca_assessments WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of dolsIds) {
    await pool.query('DELETE FROM dols WHERE id = $1', [id]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── DoLS CRUD ──────────────────────────────────────────────────────────────

describe('DoLS: create and read', () => {
  let dolId;

  it('creates a DoLS application', async () => {
    const created = await dolsRepo.upsertDols(homeA, {
      resident_name: 'Test Resident A',
      dob: '1940-05-15',
      room_number: '12',
      application_type: 'dols',
      application_date: '2026-01-10',
      authorised: false,
      notes: 'Standard application',
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    dolId = created.id;
    dolsIds.push(dolId);

    expect(created.resident_name).toBe('Test Resident A');
    expect(created.application_type).toBe('dols');
    expect(created.authorised).toBe(false);
  });

  it('reads by id', async () => {
    const found = await dolsRepo.findDolsById(dolId, homeA);
    expect(found).not.toBeNull();
    expect(found.id).toBe(dolId);
    expect(found.room_number).toBe('12');
  });

  it('blocks cross-home read', async () => {
    const found = await dolsRepo.findDolsById(dolId, homeB);
    expect(found).toBeNull();
  });
});

// ── DoLS Authorisation ─────────────────────────────────────────────────────

describe('DoLS: authorisation workflow', () => {
  let dolId;

  beforeAll(async () => {
    const created = await dolsRepo.upsertDols(homeA, {
      resident_name: 'Test Resident B',
      application_type: 'lps',
      application_date: '2025-11-01',
      authorised: false,
    });
    dolId = created.id;
    dolsIds.push(dolId);
  });

  it('updates to authorised with dates', async () => {
    const found = await dolsRepo.findDolsById(dolId, homeA);
    const updated = await dolsRepo.updateDols(dolId, homeA, {
      authorised: true,
      authorisation_date: '2025-12-01',
      expiry_date: '2026-12-01',
      authorisation_number: 'AUTH-2025-001',
      authorising_authority: 'Local Authority',
    }, found.version);

    expect(updated).not.toBeNull();
    expect(updated.authorised).toBe(true);
    expect(updated.authorisation_number).toBe('AUTH-2025-001');
    expect(updated.authorising_authority).toBe('Local Authority');
  });

  it('stores restrictions as JSON array', async () => {
    const found = await dolsRepo.findDolsById(dolId, homeA);
    const updated = await dolsRepo.updateDols(dolId, homeA, {
      restrictions: ['Must not leave building unaccompanied', 'Sensor mat at night'],
    }, found.version);

    expect(updated).not.toBeNull();
    expect(Array.isArray(updated.restrictions)).toBe(true);
    expect(updated.restrictions).toHaveLength(2);
    expect(updated.restrictions[0]).toBe('Must not leave building unaccompanied');
  });
});

// ── DoLS Optimistic Locking ────────────────────────────────────────────────

describe('DoLS: optimistic locking', () => {
  let dolId;

  beforeAll(async () => {
    const created = await dolsRepo.upsertDols(homeA, {
      resident_name: 'Test Resident C',
      application_type: 'dols',
      application_date: '2026-02-01',
      authorised: false,
    });
    dolId = created.id;
    dolsIds.push(dolId);
  });

  it('increments version on update', async () => {
    const found = await dolsRepo.findDolsById(dolId, homeA);
    const updated = await dolsRepo.updateDols(dolId, homeA,
      { notes: 'Updated notes' }, found.version
    );
    expect(updated).not.toBeNull();
    expect(updated.version).toBe(found.version + 1);
  });

  it('returns null on stale version', async () => {
    const result = await dolsRepo.updateDols(dolId, homeA,
      { notes: 'Stale update' }, 1
    );
    expect(result).toBeNull();
  });
});

// ── DoLS Pagination ────────────────────────────────────────────────────────

describe('DoLS: pagination', () => {
  it('returns { rows, total }', async () => {
    const result = await dolsRepo.findByHome(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for other home', async () => {
    const result = await dolsRepo.findByHome(homeB);
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ── DoLS Soft Delete ───────────────────────────────────────────────────────

describe('DoLS: soft delete', () => {
  let dolId;

  beforeAll(async () => {
    const created = await dolsRepo.upsertDols(homeA, {
      resident_name: 'Test Resident Delete',
      application_type: 'dols',
      application_date: '2026-03-01',
    });
    dolId = created.id;
    dolsIds.push(dolId);
  });

  it('soft-deletes and excludes from queries', async () => {
    const deleted = await dolsRepo.softDeleteDols(dolId, homeA);
    expect(deleted).toBe(true);

    const byId = await dolsRepo.findDolsById(dolId, homeA);
    expect(byId).toBeNull();
  });
});

// ── MCA Assessments CRUD ───────────────────────────────────────────────────

describe('MCA Assessments: CRUD', () => {
  let mcaId;

  it('creates an MCA assessment', async () => {
    const created = await dolsRepo.upsertMca(homeA, {
      resident_name: 'Test Resident MCA',
      assessment_date: '2026-01-20',
      assessor: 'Dr Smith',
      decision_area: 'Finances',
      lacks_capacity: true,
      best_interest_decision: 'Appointeeship arranged with local authority',
      next_review_date: '2026-07-20',
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    mcaId = created.id;
    mcaIds.push(mcaId);

    expect(created.resident_name).toBe('Test Resident MCA');
    expect(created.lacks_capacity).toBe(true);
    expect(created.assessor).toBe('Dr Smith');
  });

  it('reads MCA by id', async () => {
    const found = await dolsRepo.findMcaById(mcaId, homeA);
    expect(found).not.toBeNull();
    expect(found.decision_area).toBe('Finances');
    expect(found.best_interest_decision).toBe('Appointeeship arranged with local authority');
  });

  it('blocks cross-home MCA read', async () => {
    const found = await dolsRepo.findMcaById(mcaId, homeB);
    expect(found).toBeNull();
  });

  it('updates MCA with optimistic locking', async () => {
    const found = await dolsRepo.findMcaById(mcaId, homeA);
    const updated = await dolsRepo.updateMca(mcaId, homeA,
      { notes: 'Review confirmed capacity unchanged' }, found.version
    );
    expect(updated).not.toBeNull();
    expect(updated.notes).toBe('Review confirmed capacity unchanged');
    expect(updated.version).toBe(found.version + 1);
  });

  it('returns null on stale MCA version', async () => {
    const result = await dolsRepo.updateMca(mcaId, homeA,
      { notes: 'Stale' }, 1
    );
    expect(result).toBeNull();
  });
});

// ── MCA Pagination ─────────────────────────────────────────────────────────

describe('MCA Assessments: pagination', () => {
  it('returns { rows, total }', async () => {
    const result = await dolsRepo.findMcaByHome(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for other home', async () => {
    const result = await dolsRepo.findMcaByHome(homeB);
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ── MCA Soft Delete ────────────────────────────────────────────────────────

describe('MCA Assessments: soft delete', () => {
  let mcaId;

  beforeAll(async () => {
    const created = await dolsRepo.upsertMca(homeA, {
      resident_name: 'Test Resident MCA Delete',
      assessment_date: '2026-03-10',
      assessor: 'Dr Jones',
      decision_area: 'Medical treatment',
      lacks_capacity: false,
    });
    mcaId = created.id;
    mcaIds.push(mcaId);
  });

  it('soft-deletes MCA and excludes from queries', async () => {
    const deleted = await dolsRepo.softDeleteMca(mcaId, homeA);
    expect(deleted).toBe(true);

    const byId = await dolsRepo.findMcaById(mcaId, homeA);
    expect(byId).toBeNull();
  });
});
