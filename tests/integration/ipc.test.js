/**
 * Integration tests for IPC Audit module.
 *
 * Validates: CRUD, optimistic locking, pagination, cross-home isolation,
 * soft delete, outbreak JSONB, risk_areas array, corrective_actions array.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as ipcRepo from '../../repositories/ipcRepo.js';

let homeA, homeB;
const ids = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM ipc_audits WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'ipc-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'ipc-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('ipc-test-a', 'IPC Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('ipc-test-b', 'IPC Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;
});

afterAll(async () => {
  for (const id of ids) {
    await pool.query('DELETE FROM ipc_audits WHERE id = $1', [id]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Create & Read ────────────────────────────────────────────────────────────

describe('IPC: create and read', () => {
  let auditId;

  it('creates an IPC audit with version=1', async () => {
    const created = await ipcRepo.upsert(homeA, {
      audit_date: '2026-02-15',
      audit_type: 'hand_hygiene',
      auditor: 'IPC Lead Jane',
      overall_score: 85,
      compliance_pct: 92,
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    auditId = created.id;
    ids.push(auditId);

    expect(created.version).toBe(1);
    expect(created.audit_date).toBe('2026-02-15');
    expect(created.audit_type).toBe('hand_hygiene');
    expect(created.overall_score).toBe(85);
    expect(created.compliance_pct).toBe(92);
  });

  it('reads by id', async () => {
    const found = await ipcRepo.findById(auditId, homeA);
    expect(found).not.toBeNull();
    expect(found.id).toBe(auditId);
    expect(found.auditor).toBe('IPC Lead Jane');
  });

  it('blocks cross-home read', async () => {
    const found = await ipcRepo.findById(auditId, homeB);
    expect(found).toBeNull();
  });
});

// ── JSONB Fields ─────────────────────────────────────────────────────────────

describe('IPC: JSONB arrays and objects', () => {
  let auditId;

  it('stores risk_areas and corrective_actions arrays', async () => {
    const created = await ipcRepo.upsert(homeA, {
      audit_date: '2026-03-01',
      audit_type: 'general',
      risk_areas: [
        { area: 'Kitchen', severity: 'high', details: 'Chopping boards not colour-coded' },
        { area: 'Laundry', severity: 'medium', details: 'Soiled linen bin overflow' },
      ],
      corrective_actions: [
        { description: 'Replace chopping boards', assigned_to: 'Chef', due_date: '2026-03-15', status: 'open' },
      ],
    });

    auditId = created.id;
    ids.push(auditId);

    expect(Array.isArray(created.risk_areas)).toBe(true);
    expect(created.risk_areas).toHaveLength(2);
    expect(created.risk_areas[0].area).toBe('Kitchen');
    expect(created.risk_areas[0].severity).toBe('high');

    expect(Array.isArray(created.corrective_actions)).toBe(true);
    expect(created.corrective_actions).toHaveLength(1);
    expect(created.corrective_actions[0].description).toBe('Replace chopping boards');
  });

  it('stores outbreak object', async () => {
    const created = await ipcRepo.upsert(homeA, {
      audit_date: '2026-01-20',
      audit_type: 'outbreak_response',
      outbreak: {
        suspected: true,
        type: 'norovirus',
        start_date: '2026-01-18',
        affected_staff: 3,
        affected_residents: 8,
        measures: 'Ward isolation, enhanced cleaning',
        status: 'confirmed',
      },
    });

    ids.push(created.id);

    expect(created.outbreak).not.toBeNull();
    expect(created.outbreak.type).toBe('norovirus');
    expect(created.outbreak.affected_residents).toBe(8);
    expect(created.outbreak.status).toBe('confirmed');
  });
});

// ── Optimistic Locking ───────────────────────────────────────────────────────

describe('IPC: optimistic locking', () => {
  let auditId;

  beforeAll(async () => {
    const created = await ipcRepo.upsert(homeA, {
      audit_date: '2026-04-01',
      audit_type: 'PPE',
      overall_score: 70,
    });
    auditId = created.id;
    ids.push(auditId);
  });

  it('increments version on update', async () => {
    const updated = await ipcRepo.update(auditId, homeA,
      { overall_score: 88 }, 1
    );
    expect(updated).not.toBeNull();
    expect(updated.version).toBe(2);
    expect(updated.overall_score).toBe(88);
  });

  it('returns null on stale version', async () => {
    const result = await ipcRepo.update(auditId, homeA,
      { overall_score: 50 }, 1
    );
    expect(result).toBeNull();
  });
});

// ── Pagination ───────────────────────────────────────────────────────────────

describe('IPC: pagination', () => {
  it('returns { rows, total }', async () => {
    const result = await ipcRepo.findByHome(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for other home', async () => {
    const result = await ipcRepo.findByHome(homeB);
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ── Soft Delete ──────────────────────────────────────────────────────────────

describe('IPC: soft delete', () => {
  let auditId;

  beforeAll(async () => {
    const created = await ipcRepo.upsert(homeA, {
      audit_date: '2026-05-01',
      audit_type: 'cleanliness',
    });
    auditId = created.id;
    ids.push(auditId);
  });

  it('soft-deletes and excludes from queries', async () => {
    const deleted = await ipcRepo.softDelete(auditId, homeA);
    expect(deleted).toBe(true);

    const byId = await ipcRepo.findById(auditId, homeA);
    expect(byId).toBeNull();
  });
});
