/**
 * Integration tests for Maintenance module.
 *
 * Validates: CRUD, optimistic locking, pagination, cross-home isolation,
 * soft delete, certificate fields, item counts.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as maintenanceRepo from '../../repositories/maintenanceRepo.js';

let homeA, homeB;
const ids = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM maintenance WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'mnt-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'mnt-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('mnt-test-a', 'Maintenance Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('mnt-test-b', 'Maintenance Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;
});

afterAll(async () => {
  for (const id of ids) {
    await pool.query('DELETE FROM maintenance WHERE id = $1', [id]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Create & Read ────────────────────────────────────────────────────────────

describe('Maintenance: create and read', () => {
  let checkId;

  it('creates a maintenance check with version=1', async () => {
    const created = await maintenanceRepo.upsert(homeA, {
      category: 'PAT',
      description: 'Portable appliance testing — all bedrooms',
      frequency: 'annual',
      next_due: '2026-06-01',
      items_checked: 45,
      items_passed: 43,
      items_failed: 2,
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    checkId = created.id;
    ids.push(checkId);

    expect(created.version).toBe(1);
    expect(created.category).toBe('PAT');
    expect(created.description).toBe('Portable appliance testing — all bedrooms');
    expect(created.items_checked).toBe(45);
    expect(created.items_passed).toBe(43);
    expect(created.items_failed).toBe(2);
  });

  it('reads by id', async () => {
    const found = await maintenanceRepo.findById(checkId, homeA);
    expect(found).not.toBeNull();
    expect(found.id).toBe(checkId);
    expect(found.frequency).toBe('annual');
  });

  it('blocks cross-home read', async () => {
    const found = await maintenanceRepo.findById(checkId, homeB);
    expect(found).toBeNull();
  });
});

// ── Certificate fields ───────────────────────────────────────────────────────

describe('Maintenance: certificate fields', () => {
  let checkId;

  it('stores certificate ref and expiry', async () => {
    const created = await maintenanceRepo.upsert(homeA, {
      category: 'Gas Safety',
      description: 'Annual gas safety inspection',
      certificate_ref: 'GAS-2026-042',
      certificate_expiry: '2027-03-15',
      last_completed: '2026-03-15',
      next_due: '2027-03-15',
      completed_by: 'British Gas',
      contractor: 'British Gas Commercial',
    });

    checkId = created.id;
    ids.push(checkId);

    expect(created.certificate_ref).toBe('GAS-2026-042');
    expect(created.certificate_expiry).toBe('2027-03-15');
    expect(created.last_completed).toBe('2026-03-15');
    expect(created.completed_by).toBe('British Gas');
    expect(created.contractor).toBe('British Gas Commercial');
  });
});

// ── Optimistic Locking ───────────────────────────────────────────────────────

describe('Maintenance: optimistic locking', () => {
  let checkId;

  beforeAll(async () => {
    const created = await maintenanceRepo.upsert(homeA, {
      category: 'Legionella',
      description: 'Water temperature checks',
    });
    checkId = created.id;
    ids.push(checkId);
  });

  it('increments version on update', async () => {
    const updated = await maintenanceRepo.update(checkId, homeA,
      { description: 'Weekly water temperature checks' }, 1
    );
    expect(updated).not.toBeNull();
    expect(updated.version).toBe(2);
    expect(updated.description).toBe('Weekly water temperature checks');
  });

  it('returns null on stale version', async () => {
    const result = await maintenanceRepo.update(checkId, homeA,
      { description: 'Stale update' }, 1
    );
    expect(result).toBeNull();
  });
});

// ── Pagination ───────────────────────────────────────────────────────────────

describe('Maintenance: pagination', () => {
  it('returns { rows, total }', async () => {
    const result = await maintenanceRepo.findByHome(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for other home', async () => {
    const result = await maintenanceRepo.findByHome(homeB);
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('respects limit and offset', async () => {
    const result = await maintenanceRepo.findByHome(homeA, { limit: 1, offset: 0 });
    expect(result.rows).toHaveLength(1);
    expect(result.total).toBeGreaterThanOrEqual(2);
  });
});

// ── Soft Delete ──────────────────────────────────────────────────────────────

describe('Maintenance: soft delete', () => {
  let checkId;

  beforeAll(async () => {
    const created = await maintenanceRepo.upsert(homeA, {
      category: 'Fire Risk',
      description: 'Fire risk assessment',
    });
    checkId = created.id;
    ids.push(checkId);
  });

  it('soft-deletes and excludes from queries', async () => {
    const deleted = await maintenanceRepo.softDelete(checkId, homeA);
    expect(deleted).toBe(true);

    const byId = await maintenanceRepo.findById(checkId, homeA);
    expect(byId).toBeNull();
  });

  it('returns false for already-deleted record', async () => {
    const deleted = await maintenanceRepo.softDelete(checkId, homeA);
    expect(deleted).toBe(false);
  });

  it('returns false for non-existent record', async () => {
    const deleted = await maintenanceRepo.softDelete('nonexistent-id', homeA);
    expect(deleted).toBe(false);
  });
});
