/**
 * Integration tests for Policy Review module.
 *
 * Validates: CRUD, optimistic locking, pagination, cross-home isolation,
 * soft delete, changes array (version history), review frequency.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as policyRepo from '../../repositories/policyRepo.js';

let homeA, homeB;
const ids = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM policy_reviews WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'pol-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'pol-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('pol-test-a', 'Policy Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('pol-test-b', 'Policy Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;
});

afterAll(async () => {
  for (const id of ids) {
    await pool.query('DELETE FROM policy_reviews WHERE id = $1', [id]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Create & Read ────────────────────────────────────────────────────────────

describe('Policy Review: create and read', () => {
  let polId;

  it('creates a policy with version=1', async () => {
    const created = await policyRepo.upsert(homeA, {
      policy_name: 'Safeguarding Adults Policy',
      policy_ref: 'SAF-001',
      category: 'safeguarding',
      doc_version: '3.0',
      last_reviewed: '2026-01-15',
      next_review_due: '2027-01-15',
      review_frequency_months: 12,
      status: 'current',
      reviewed_by: 'Safeguarding Lead',
      approved_by: 'Registered Manager',
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    polId = created.id;
    ids.push(polId);

    expect(created.version).toBe(1);
    expect(created.policy_name).toBe('Safeguarding Adults Policy');
    expect(created.policy_ref).toBe('SAF-001');
    expect(created.review_frequency_months).toBe(12);
    expect(created.status).toBe('current');
  });

  it('reads by id', async () => {
    const found = await policyRepo.findById(polId, homeA);
    expect(found).not.toBeNull();
    expect(found.id).toBe(polId);
    expect(found.reviewed_by).toBe('Safeguarding Lead');
  });

  it('blocks cross-home read', async () => {
    const found = await policyRepo.findById(polId, homeB);
    expect(found).toBeNull();
  });
});

// ── Changes Array (Version History) ──────────────────────────────────────────

describe('Policy Review: changes array', () => {
  let polId;

  it('stores changes array as JSONB', async () => {
    const created = await policyRepo.upsert(homeA, {
      policy_name: 'Complaints Policy',
      category: 'complaints',
      changes: [
        { version: '1.0', date: '2024-01-01', summary: 'Initial policy' },
        { version: '2.0', date: '2025-06-01', summary: 'Updated complaint response timelines' },
      ],
    });

    polId = created.id;
    ids.push(polId);

    expect(Array.isArray(created.changes)).toBe(true);
    expect(created.changes).toHaveLength(2);
    expect(created.changes[1].summary).toBe('Updated complaint response timelines');
  });
});

// ── Optimistic Locking ───────────────────────────────────────────────────────

describe('Policy Review: optimistic locking', () => {
  let polId;

  beforeAll(async () => {
    const created = await policyRepo.upsert(homeA, {
      policy_name: 'Test Locking Policy',
      status: 'current',
    });
    polId = created.id;
    ids.push(polId);
  });

  it('increments version on update', async () => {
    const updated = await policyRepo.update(polId, homeA,
      { status: 'overdue' }, 1
    );
    expect(updated).not.toBeNull();
    expect(updated.version).toBe(2);
    expect(updated.status).toBe('overdue');
  });

  it('returns null on stale version', async () => {
    const result = await policyRepo.update(polId, homeA,
      { status: 'current' }, 1
    );
    expect(result).toBeNull();
  });
});

// ── Pagination ───────────────────────────────────────────────────────────────

describe('Policy Review: pagination', () => {
  it('returns { rows, total }', async () => {
    const result = await policyRepo.findByHome(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for other home', async () => {
    const result = await policyRepo.findByHome(homeB);
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ── Soft Delete ──────────────────────────────────────────────────────────────

describe('Policy Review: soft delete', () => {
  let polId;

  beforeAll(async () => {
    const created = await policyRepo.upsert(homeA, {
      policy_name: 'Test Delete Policy',
      status: 'current',
    });
    polId = created.id;
    ids.push(polId);
  });

  it('soft-deletes and excludes from queries', async () => {
    const deleted = await policyRepo.softDelete(polId, homeA);
    expect(deleted).toBe(true);

    const byId = await policyRepo.findById(polId, homeA);
    expect(byId).toBeNull();
  });
});
