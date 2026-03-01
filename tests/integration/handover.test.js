/**
 * Integration tests for Handover module.
 *
 * Validates: create, date-based queries, acknowledge, update,
 * cross-home isolation, soft delete, date range queries.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as handoverRepo from '../../repositories/handoverRepo.js';

let homeA, homeB;
const entryIds = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM handover_entries WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'hov-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'hov-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('hov-test-a', 'Handover Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('hov-test-b', 'Handover Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;
});

afterAll(async () => {
  for (const id of entryIds) {
    await pool.query('DELETE FROM handover_entries WHERE id = $1', [id]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Create & Read ────────────────────────────────────────────────────────────

describe('Handover: create and read', () => {
  let entryId;

  it('creates a handover entry with UUID', async () => {
    const created = await handoverRepo.createEntry(homeA, {
      entry_date: '2026-02-15',
      shift: 'E',
      category: 'clinical',
      priority: 'urgent',
      content: 'Resident in room 12 had a fall at 06:30. GP called.',
      incident_id: null,
    }, 'admin');

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    entryId = created.id;
    entryIds.push(entryId);

    expect(created.entry_date).toBe('2026-02-15');
    expect(created.shift).toBe('E');
    expect(created.category).toBe('clinical');
    expect(created.priority).toBe('urgent');
    expect(created.content).toContain('room 12');
    expect(created.author).toBe('admin');
    expect(created.acknowledged_by).toBeNull();
  });

  it('reads by date', async () => {
    const result = await handoverRepo.findByHomeAndDate(homeA, '2026-02-15');
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.rows[0].id).toBe(entryId);
  });

  it('returns empty for different date', async () => {
    const result = await handoverRepo.findByHomeAndDate(homeA, '2026-02-16');
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('blocks cross-home read', async () => {
    const result = await handoverRepo.findByHomeAndDate(homeB, '2026-02-15');
    expect(result.total).toBe(0);
  });
});

// ── Date Range Queries ──────────────────────────────────────────────────────

describe('Handover: date range queries', () => {
  beforeAll(async () => {
    // Create entries across multiple dates
    for (const date of ['2026-03-01', '2026-03-02', '2026-03-03']) {
      const created = await handoverRepo.createEntry(homeA, {
        entry_date: date,
        shift: 'L',
        category: 'operational',
        priority: 'info',
        content: `Late shift handover for ${date}`,
      }, 'admin');
      entryIds.push(created.id);
    }
  });

  it('returns entries within date range', async () => {
    const result = await handoverRepo.findByHomeAndDateRange(homeA, '2026-03-01', '2026-03-03');
    expect(result.total).toBe(3);
    expect(result.rows).toHaveLength(3);
  });

  it('partial date range returns subset', async () => {
    const result = await handoverRepo.findByHomeAndDateRange(homeA, '2026-03-01', '2026-03-02');
    expect(result.total).toBe(2);
  });
});

// ── Update ──────────────────────────────────────────────────────────────────

describe('Handover: update', () => {
  let entryId;

  beforeAll(async () => {
    const created = await handoverRepo.createEntry(homeA, {
      entry_date: '2026-04-01',
      shift: 'N',
      category: 'safety',
      priority: 'info',
      content: 'Original content',
    }, 'admin');
    entryId = created.id;
    entryIds.push(entryId);
  });

  it('updates content and priority', async () => {
    const updated = await handoverRepo.updateEntry(entryId, homeA, {
      content: 'Updated content with more detail',
      priority: 'urgent',
    });
    expect(updated).not.toBeNull();
    expect(updated.content).toBe('Updated content with more detail');
    expect(updated.priority).toBe('urgent');
  });

  it('returns null for wrong home', async () => {
    const updated = await handoverRepo.updateEntry(entryId, homeB, {
      content: 'Cross-home attempt',
      priority: 'info',
    });
    expect(updated).toBeNull();
  });
});

// ── Acknowledge ─────────────────────────────────────────────────────────────

describe('Handover: acknowledge', () => {
  let entryId;

  beforeAll(async () => {
    const created = await handoverRepo.createEntry(homeA, {
      entry_date: '2026-04-10',
      shift: 'E',
      category: 'admin',
      priority: 'info',
      content: 'Staff meeting minutes uploaded',
    }, 'admin');
    entryId = created.id;
    entryIds.push(entryId);
  });

  it('marks entry as acknowledged', async () => {
    const acked = await handoverRepo.acknowledgeEntry(entryId, homeA, 'viewer');
    expect(acked).not.toBeNull();
    expect(acked.acknowledged_by).toBe('viewer');
    expect(acked.acknowledged_at).toBeTruthy();
  });

  it('returns null for wrong home', async () => {
    const acked = await handoverRepo.acknowledgeEntry(entryId, homeB, 'viewer');
    expect(acked).toBeNull();
  });
});

// ── Soft Delete ──────────────────────────────────────────────────────────────

describe('Handover: soft delete', () => {
  let entryId;

  beforeAll(async () => {
    const created = await handoverRepo.createEntry(homeA, {
      entry_date: '2026-05-01',
      shift: 'L',
      category: 'operational',
      priority: 'info',
      content: 'Test delete entry',
    }, 'admin');
    entryId = created.id;
    entryIds.push(entryId);
  });

  it('soft-deletes and excludes from queries', async () => {
    const deleted = await handoverRepo.deleteEntry(entryId, homeA);
    expect(deleted).toBe(true);

    const result = await handoverRepo.findByHomeAndDate(homeA, '2026-05-01');
    expect(result.total).toBe(0);
  });

  it('returns false for already-deleted entry', async () => {
    const deleted = await handoverRepo.deleteEntry(entryId, homeA);
    expect(deleted).toBe(false);
  });
});
