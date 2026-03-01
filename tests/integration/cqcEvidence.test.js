/**
 * Integration tests for CQC Evidence module.
 *
 * Validates: CRUD, optimistic locking, pagination, cross-home isolation,
 * soft delete, quality_statement codes, type enum.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as cqcEvidenceRepo from '../../repositories/cqcEvidenceRepo.js';

let homeA, homeB;
const ids = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM cqc_evidence WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'cqc-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'cqc-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('cqc-test-a', 'CQC Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('cqc-test-b', 'CQC Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;
});

afterAll(async () => {
  for (const id of ids) {
    await pool.query('DELETE FROM cqc_evidence WHERE id = $1', [id]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Create & Read ────────────────────────────────────────────────────────────

describe('CQC Evidence: create and read', () => {
  let evidenceId;

  it('creates evidence with version=1', async () => {
    const created = await cqcEvidenceRepo.upsert(homeA, {
      quality_statement: 'S1',
      type: 'quantitative',
      title: 'Staffing fill rate Q1 2026',
      description: 'Average daily fill rate across all shifts',
      date_from: '2026-01-01',
      date_to: '2026-03-31',
      added_by: 'admin',
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    evidenceId = created.id;
    ids.push(evidenceId);

    expect(created.version).toBe(1);
    expect(created.quality_statement).toBe('S1');
    expect(created.type).toBe('quantitative');
    expect(created.title).toBe('Staffing fill rate Q1 2026');
    expect(created.date_from).toBe('2026-01-01');
    expect(created.date_to).toBe('2026-03-31');
  });

  it('reads by id', async () => {
    const found = await cqcEvidenceRepo.findById(evidenceId, homeA);
    expect(found).not.toBeNull();
    expect(found.id).toBe(evidenceId);
    expect(found.added_by).toBe('admin');
  });

  it('blocks cross-home read', async () => {
    const found = await cqcEvidenceRepo.findById(evidenceId, homeB);
    expect(found).toBeNull();
  });
});

// ── Quality Statement Codes ──────────────────────────────────────────────────

describe('CQC Evidence: quality statement codes', () => {
  it('stores all 5 CQC question prefixes', async () => {
    const codes = ['S1', 'E3', 'C5', 'R2', 'WL10'];
    for (const code of codes) {
      const created = await cqcEvidenceRepo.upsert(homeA, {
        quality_statement: code,
        type: 'qualitative',
        title: `Evidence for ${code}`,
        added_by: 'admin',
      });
      ids.push(created.id);
      expect(created.quality_statement).toBe(code);
    }
  });
});

// ── Optimistic Locking ───────────────────────────────────────────────────────

describe('CQC Evidence: optimistic locking', () => {
  let evidenceId;

  beforeAll(async () => {
    const created = await cqcEvidenceRepo.upsert(homeA, {
      quality_statement: 'S2',
      type: 'quantitative',
      title: 'Test locking evidence',
      added_by: 'admin',
    });
    evidenceId = created.id;
    ids.push(evidenceId);
  });

  it('increments version on update', async () => {
    const updated = await cqcEvidenceRepo.update(evidenceId, homeA,
      { title: 'Updated evidence title' }, 1
    );
    expect(updated).not.toBeNull();
    expect(updated.version).toBe(2);
    expect(updated.title).toBe('Updated evidence title');
  });

  it('returns null on stale version', async () => {
    const result = await cqcEvidenceRepo.update(evidenceId, homeA,
      { title: 'Stale update' }, 1
    );
    expect(result).toBeNull();
  });
});

// ── Pagination ───────────────────────────────────────────────────────────────

describe('CQC Evidence: pagination', () => {
  it('returns { rows, total }', async () => {
    const result = await cqcEvidenceRepo.findByHome(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for other home', async () => {
    const result = await cqcEvidenceRepo.findByHome(homeB);
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ── Soft Delete ──────────────────────────────────────────────────────────────

describe('CQC Evidence: soft delete', () => {
  let evidenceId;

  beforeAll(async () => {
    const created = await cqcEvidenceRepo.upsert(homeA, {
      quality_statement: 'WL1',
      type: 'qualitative',
      title: 'Test delete evidence',
      added_by: 'admin',
    });
    evidenceId = created.id;
    ids.push(evidenceId);
  });

  it('soft-deletes and excludes from queries', async () => {
    const deleted = await cqcEvidenceRepo.softDelete(evidenceId, homeA);
    expect(deleted).toBe(true);

    const byId = await cqcEvidenceRepo.findById(evidenceId, homeA);
    expect(byId).toBeNull();
  });
});
