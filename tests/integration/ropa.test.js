/**
 * Integration tests for ROPA (Record of Processing Activities) module.
 *
 * Validates: CRUD, optimistic locking, pagination, cross-home isolation,
 * soft delete, status filter, Article 30 required fields.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as ropaRepo from '../../repositories/ropaRepo.js';

let homeA, homeB;

beforeAll(async () => {
  await pool.query(`DELETE FROM ropa_activities WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'ropa-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'ropa-test-%'`);
  const { rows: [ha] } = await pool.query(`INSERT INTO homes (slug, name, config) VALUES ('ropa-test-a', 'ROPA Test A', '{}') RETURNING id`);
  const { rows: [hb] } = await pool.query(`INSERT INTO homes (slug, name, config) VALUES ('ropa-test-b', 'ROPA Test B', '{}') RETURNING id`);
  homeA = ha.id;
  homeB = hb.id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM ropa_activities WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'ropa-test-%'`);
});

describe('ROPA: create and read', () => {
  let activityId;

  it('creates an activity with version=1 and required Article 30 fields', async () => {
    const result = await ropaRepo.create(homeA, {
      purpose: 'Staff payroll processing',
      legal_basis: 'legal_obligation',
      categories_of_individuals: 'Staff',
      categories_of_data: 'Financial, NI numbers',
      categories_of_recipients: 'HMRC',
      retention_period: '7 years after leaving',
      special_category: false,
      created_by: 'admin',
    });
    expect(result).not.toBeNull();
    expect(result.id).toBeGreaterThan(0);
    activityId = result.id;
    expect(result.version).toBe(1);
    expect(result.purpose).toBe('Staff payroll processing');
    expect(result.legal_basis).toBe('legal_obligation');
    expect(result.status).toBe('active');
    expect(result.special_category).toBe(false);
  });

  it('reads by id with home scoping', async () => {
    const result = await ropaRepo.findById(activityId, homeA);
    expect(result).not.toBeNull();
    expect(result.purpose).toBe('Staff payroll processing');
  });

  it('returns null for wrong home (cross-home isolation)', async () => {
    const result = await ropaRepo.findById(activityId, homeB);
    expect(result).toBeNull();
  });
});

describe('ROPA: update with optimistic locking', () => {
  let activity;

  beforeAll(async () => {
    activity = await ropaRepo.create(homeA, {
      purpose: 'Resident care records',
      legal_basis: 'vital_interests',
      categories_of_individuals: 'Residents',
      categories_of_data: 'Health, medication',
      special_category: true,
      created_by: 'admin',
    });
  });

  it('updates and increments version', async () => {
    const updated = await ropaRepo.update(activity.id, homeA, { status: 'under_review' }, null, activity.version);
    expect(updated).not.toBeNull();
    expect(updated.version).toBe(activity.version + 1);
    expect(updated.status).toBe('under_review');
    expect(updated.updated_at).not.toBe(updated.created_at);
  });

  it('returns null on stale version (409 scenario)', async () => {
    const stale = await ropaRepo.update(activity.id, homeA, { status: 'archived' }, null, activity.version);
    expect(stale).toBeNull();
  });
});

describe('ROPA: list and filter', () => {
  it('lists activities for home A only', async () => {
    const result = await ropaRepo.findAll(homeA);
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    expect(result.total).toBeGreaterThanOrEqual(2);
    for (const r of result.rows) expect(r.home_id).toBe(homeA);
  });

  it('returns empty for home B', async () => {
    const result = await ropaRepo.findAll(homeB);
    expect(result.rows.length).toBe(0);
    expect(result.total).toBe(0);
  });

  it('filters by status', async () => {
    const result = await ropaRepo.findAll(homeA, { status: 'under_review' });
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    for (const r of result.rows) expect(r.status).toBe('under_review');
  });
});

describe('ROPA: soft delete', () => {
  let activity;

  beforeAll(async () => {
    activity = await ropaRepo.create(homeA, {
      purpose: 'To be deleted',
      legal_basis: 'consent',
      categories_of_individuals: 'Staff',
      categories_of_data: 'Contact details',
      created_by: 'admin',
    });
  });

  it('soft deletes and makes record invisible', async () => {
    const result = await ropaRepo.softDelete(activity.id, homeA);
    expect(result).not.toBeNull();
    const found = await ropaRepo.findById(activity.id, homeA);
    expect(found).toBeNull();
  });

  it('returns null when deleting from wrong home', async () => {
    const activity2 = await ropaRepo.create(homeA, {
      purpose: 'Cross-home delete test',
      legal_basis: 'consent',
      categories_of_individuals: 'Staff',
      categories_of_data: 'Names',
      created_by: 'admin',
    });
    const result = await ropaRepo.softDelete(activity2.id, homeB);
    expect(result).toBeNull();
  });
});

describe('ROPA: countActive', () => {
  it('counts only active non-deleted records', async () => {
    const count = await ropaRepo.countActive(homeA);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('returns 0 for empty home', async () => {
    const count = await ropaRepo.countActive(homeB);
    expect(count).toBe(0);
  });
});
