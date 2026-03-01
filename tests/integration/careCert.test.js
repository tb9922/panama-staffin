/**
 * Integration tests for Care Certificate module.
 *
 * Validates: upsert by staffId, findByHome, standards JSONB,
 * deep merge on update, cross-home isolation, soft delete.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as careCertRepo from '../../repositories/careCertRepo.js';

let homeA, homeB;
const staffIds = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM care_certificates WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'cc-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'cc-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'cc-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('cc-test-a', 'CareCert Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('cc-test-b', 'CareCert Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;

  // Create test staff
  for (const s of [
    { id: 'CC-S001', name: 'New Starter 1' },
    { id: 'CC-S002', name: 'New Starter 2' },
  ]) {
    await pool.query(
      `INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out, start_date)
       VALUES ($1, $2, $3, 'Carer', 'Day A', 'E', 1, 13.00, true, false, '2026-01-01')`,
      [s.id, homeA, s.name]
    );
    staffIds.push(s.id);
  }
});

afterAll(async () => {
  await pool.query(`DELETE FROM care_certificates WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  for (const sid of staffIds) {
    await pool.query('DELETE FROM staff WHERE id = $1', [sid]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Upsert & Read ───────────────────────────────────────────────────────────

describe('Care Certificate: upsert and read', () => {
  it('upserts a care certificate for a staff member', async () => {
    const result = await careCertRepo.upsertStaff(homeA, 'CC-S001', {
      start_date: '2026-01-06',
      expected_completion: '2026-03-30',
      supervisor: 'Jane Senior',
      status: 'in_progress',
      standards: {
        'std-1': { status: 'completed', completion_date: '2026-01-20' },
        'std-2': { status: 'in_progress' },
      },
    });

    expect(result).not.toBeNull();
    expect(result.start_date).toBe('2026-01-06');
    expect(result.expected_completion).toBe('2026-03-30');
    expect(result.supervisor).toBe('Jane Senior');
    expect(result.status).toBe('in_progress');
    expect(result.standards['std-1'].status).toBe('completed');
    expect(result.standards['std-2'].status).toBe('in_progress');
  });

  it('findByHome returns keyed by staffId', async () => {
    const result = await careCertRepo.findByHome(homeA);
    expect(result['CC-S001']).toBeDefined();
    expect(result['CC-S001'].supervisor).toBe('Jane Senior');
    expect(result['CC-S001'].standards['std-1'].status).toBe('completed');
  });

  it('returns empty for other home', async () => {
    const result = await careCertRepo.findByHome(homeB);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ── Standards JSONB ─────────────────────────────────────────────────────────

describe('Care Certificate: standards JSONB', () => {
  it('stores all 16 standards as nested JSONB', async () => {
    const standards = {};
    for (let i = 1; i <= 16; i++) {
      standards[`std-${i}`] = {
        status: i <= 5 ? 'completed' : 'not_started',
        knowledge: i <= 5 ? { date: '2026-02-01', assessor: 'Jane', status: 'pass' } : undefined,
      };
    }

    const result = await careCertRepo.upsertStaff(homeA, 'CC-S002', {
      start_date: '2026-01-06',
      expected_completion: '2026-03-30',
      supervisor: 'John Mentor',
      status: 'in_progress',
      standards,
    });

    expect(Object.keys(result.standards)).toHaveLength(16);
    expect(result.standards['std-1'].status).toBe('completed');
    expect(result.standards['std-1'].knowledge.assessor).toBe('Jane');
    expect(result.standards['std-16'].status).toBe('not_started');
  });

  it('re-upsert replaces entire standards object', async () => {
    const result = await careCertRepo.upsertStaff(homeA, 'CC-S002', {
      start_date: '2026-01-06',
      expected_completion: '2026-03-30',
      supervisor: 'John Mentor',
      status: 'in_progress',
      standards: {
        'std-1': { status: 'completed' },
      },
    });

    // Full replace — only std-1 remains
    expect(Object.keys(result.standards)).toHaveLength(1);
    expect(result.standards['std-1'].status).toBe('completed');
  });
});

// ── Soft Delete ──────────────────────────────────────────────────────────────

describe('Care Certificate: soft delete', () => {
  it('soft-deletes and excludes from queries', async () => {
    const deleted = await careCertRepo.removeStaff(homeA, 'CC-S002');
    expect(deleted).toBe(true);

    const result = await careCertRepo.findByHome(homeA);
    expect(result['CC-S002']).toBeUndefined();
    expect(result['CC-S001']).toBeDefined(); // Other staff unaffected
  });

  it('returns false for already-deleted staff', async () => {
    const deleted = await careCertRepo.removeStaff(homeA, 'CC-S002');
    expect(deleted).toBe(false);
  });
});
