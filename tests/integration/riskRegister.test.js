/**
 * Integration tests for Risk Register module.
 *
 * Validates: CRUD, optimistic locking, pagination, cross-home isolation,
 * soft delete, controls/actions JSONB arrays, risk scoring.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as riskRepo from '../../repositories/riskRepo.js';

let homeA, homeB;
const ids = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM risk_register WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'rsk-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'rsk-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('rsk-test-a', 'Risk Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('rsk-test-b', 'Risk Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;
});

afterAll(async () => {
  for (const id of ids) {
    await pool.query('DELETE FROM risk_register WHERE id = $1', [id]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Create & Read ────────────────────────────────────────────────────────────

describe('Risk Register: create and read', () => {
  let riskId;

  it('creates a risk with version=1', async () => {
    const created = await riskRepo.upsert(homeA, {
      title: 'Staffing shortfall during winter',
      description: 'Seasonal sickness increases gap between planned and actual staffing',
      category: 'staffing',
      owner: 'Registered Manager',
      likelihood: 4,
      impact: 3,
      inherent_risk: 12,
      residual_likelihood: 2,
      residual_impact: 3,
      residual_risk: 6,
      status: 'open',
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    riskId = created.id;
    ids.push(riskId);

    expect(created.version).toBe(1);
    expect(created.title).toBe('Staffing shortfall during winter');
    expect(created.category).toBe('staffing');
    expect(created.likelihood).toBe(4);
    expect(created.impact).toBe(3);
    expect(created.inherent_risk).toBe(12);
    expect(created.residual_risk).toBe(6);
  });

  it('reads by id', async () => {
    const found = await riskRepo.findById(riskId, homeA);
    expect(found).not.toBeNull();
    expect(found.id).toBe(riskId);
    expect(found.owner).toBe('Registered Manager');
  });

  it('blocks cross-home read', async () => {
    const found = await riskRepo.findById(riskId, homeB);
    expect(found).toBeNull();
  });
});

// ── JSONB Fields ─────────────────────────────────────────────────────────────

describe('Risk Register: controls and actions', () => {
  let riskId;

  it('stores controls and actions arrays', async () => {
    const created = await riskRepo.upsert(homeA, {
      title: 'Medication errors',
      category: 'clinical',
      controls: [
        { description: 'Double-check policy', effectiveness: 'effective' },
        { description: 'Competency assessments', effectiveness: 'partially_effective' },
      ],
      actions: [
        { description: 'Review med admin procedure', owner: 'Clinical Lead', due_date: '2026-04-01', status: 'open' },
      ],
      status: 'open',
    });

    riskId = created.id;
    ids.push(riskId);

    expect(Array.isArray(created.controls)).toBe(true);
    expect(created.controls).toHaveLength(2);
    expect(created.controls[0].description).toBe('Double-check policy');

    expect(Array.isArray(created.actions)).toBe(true);
    expect(created.actions).toHaveLength(1);
    expect(created.actions[0].owner).toBe('Clinical Lead');
  });
});

// ── Optimistic Locking ───────────────────────────────────────────────────────

describe('Risk Register: optimistic locking', () => {
  let riskId;

  beforeAll(async () => {
    const created = await riskRepo.upsert(homeA, {
      title: 'Test locking risk',
      category: 'operational',
      status: 'open',
    });
    riskId = created.id;
    ids.push(riskId);
  });

  it('increments version on update', async () => {
    const updated = await riskRepo.update(riskId, homeA,
      { status: 'mitigated' }, 1
    );
    expect(updated).not.toBeNull();
    expect(updated.version).toBe(2);
  });

  it('returns null on stale version', async () => {
    const result = await riskRepo.update(riskId, homeA,
      { status: 'closed' }, 1
    );
    expect(result).toBeNull();
  });
});

// ── Pagination ───────────────────────────────────────────────────────────────

describe('Risk Register: pagination', () => {
  it('returns { rows, total }', async () => {
    const result = await riskRepo.findByHome(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for other home', async () => {
    const result = await riskRepo.findByHome(homeB);
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ── Soft Delete ──────────────────────────────────────────────────────────────

describe('Risk Register: soft delete', () => {
  let riskId;

  beforeAll(async () => {
    const created = await riskRepo.upsert(homeA, {
      title: 'Test delete risk',
      category: 'compliance',
      status: 'open',
    });
    riskId = created.id;
    ids.push(riskId);
  });

  it('soft-deletes and excludes from queries', async () => {
    const deleted = await riskRepo.softDelete(riskId, homeA);
    expect(deleted).toBe(true);

    const byId = await riskRepo.findById(riskId, homeA);
    expect(byId).toBeNull();
  });
});
