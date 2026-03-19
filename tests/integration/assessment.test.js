/**
 * Integration tests for Assessment Snapshot module.
 *
 * Validates: create with server-computed score, deduplication,
 * list by engine, get by id, sign-off workflow (self-sign-off blocked,
 * double sign-off blocked), cross-home isolation.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as assessmentRepo from '../../repositories/assessmentRepo.js';

let homeA, homeB;
const snapshotIds = [];

beforeAll(async () => {
  // Clean up any prior test data
  await pool.query(`DELETE FROM assessment_snapshots WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'assess-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'assess-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ('assess-test-a', 'Assess Test Home A', '{}') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ('assess-test-b', 'Assess Test Home B', '{}') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;
});

afterAll(async () => {
  for (const id of snapshotIds) {
    await pool.query('DELETE FROM assessment_snapshots WHERE id = $1', [id]).catch(() => {});
  }
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'assess-test-%'`);
});

// ── Create ──────────────────────────────────────────────────────────────────

describe('Assessment Snapshots: create', () => {
  it('creates a CQC snapshot with required fields', async () => {
    const snapshot = await assessmentRepo.create(homeA, {
      engine: 'cqc',
      engine_version: 'v2',
      overall_score: 82,
      band: 'Good',
      result: { overallScore: 82, band: { label: 'Good' }, metrics: {} },
      computed_by: 'admin',
      input_hash: 'abc123def456',
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot.id).toBeGreaterThan(0);
    snapshotIds.push(snapshot.id);

    expect(snapshot.engine).toBe('cqc');
    expect(snapshot.engine_version).toBe('v2');
    expect(snapshot.overall_score).toBe(82);
    expect(snapshot.band).toBe('Good');
    expect(snapshot.computed_by).toBe('admin');
    expect(snapshot.input_hash).toBe('abc123def456');
    expect(snapshot.signed_off_by).toBeNull();
  });

  it('creates a GDPR snapshot', async () => {
    const snapshot = await assessmentRepo.create(homeA, {
      engine: 'gdpr',
      engine_version: 'v2',
      overall_score: 71,
      band: 'Adequate',
      result: { overallScore: 71, domains: {} },
      computed_by: 'admin',
      input_hash: 'gdpr-hash-001',
    });

    expect(snapshot).not.toBeNull();
    snapshotIds.push(snapshot.id);
    expect(snapshot.engine).toBe('gdpr');
    expect(snapshot.overall_score).toBe(71);
  });

  it('rejects duplicate input_hash for same home + engine (409)', async () => {
    try {
      await assessmentRepo.create(homeA, {
        engine: 'cqc',
        engine_version: 'v2',
        overall_score: 82,
        band: 'Good',
        result: { overallScore: 82 },
        computed_by: 'admin',
        input_hash: 'abc123def456', // same hash as first CQC snapshot
      });
      expect.fail('Should have thrown unique constraint error');
    } catch (err) {
      expect(err.code).toBe('23505');
    }
  });

  it('allows same hash for different homes', async () => {
    const snapshot = await assessmentRepo.create(homeB, {
      engine: 'cqc',
      engine_version: 'v2',
      overall_score: 90,
      band: 'Outstanding',
      result: { overallScore: 90 },
      computed_by: 'admin',
      input_hash: 'abc123def456', // same hash, different home
    });
    expect(snapshot).not.toBeNull();
    snapshotIds.push(snapshot.id);
  });
});

// ── List ────────────────────────────────────────────────────────────────────

describe('Assessment Snapshots: list', () => {
  it('lists CQC snapshots for home A only', async () => {
    const snapshots = await assessmentRepo.findByHome(homeA, 'cqc');
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    for (const s of snapshots) {
      expect(s.home_id).toBe(homeA);
      expect(s.engine).toBe('cqc');
    }
  });

  it('lists GDPR snapshots for home A', async () => {
    const snapshots = await assessmentRepo.findByHome(homeA, 'gdpr');
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    for (const s of snapshots) {
      expect(s.engine).toBe('gdpr');
    }
  });

  it('returns empty for home B gdpr (none created)', async () => {
    const snapshots = await assessmentRepo.findByHome(homeB, 'gdpr');
    expect(snapshots.length).toBe(0);
  });
});

// ── Get by ID ───────────────────────────────────────────────────────────────

describe('Assessment Snapshots: get by id', () => {
  it('returns snapshot by id + home_id', async () => {
    const snapshot = await assessmentRepo.findById(snapshotIds[0], homeA);
    expect(snapshot).not.toBeNull();
    expect(snapshot.id).toBe(snapshotIds[0]);
    expect(snapshot.engine).toBe('cqc');
  });

  it('returns null for wrong home (cross-home isolation)', async () => {
    const snapshot = await assessmentRepo.findById(snapshotIds[0], homeB);
    expect(snapshot).toBeNull();
  });

  it('returns null for non-existent id', async () => {
    const snapshot = await assessmentRepo.findById(99999, homeA);
    expect(snapshot).toBeNull();
  });
});

// ── Sign-off ────────────────────────────────────────────────────────────────

describe('Assessment Snapshots: sign-off', () => {
  it('signs off a snapshot with different user', async () => {
    const snapshot = await assessmentRepo.signOff(snapshotIds[0], homeA, 'manager', 'Reviewed and approved');
    expect(snapshot).not.toBeNull();
    expect(snapshot.signed_off_by).toBe('manager');
    expect(snapshot.sign_off_notes).toBe('Reviewed and approved');
    expect(snapshot.signed_off_at).toBeTruthy();
  });

  it('returns null for already signed-off snapshot', async () => {
    const result = await assessmentRepo.signOff(snapshotIds[0], homeA, 'another_manager', 'Second attempt');
    expect(result).toBeNull();
  });

  it('returns null for self-sign-off (computed_by === signed_off_by)', async () => {
    // Use GDPR snapshot (snapshotIds[1]) which was computed by 'admin'
    const result = await assessmentRepo.signOff(snapshotIds[1], homeA, 'admin', 'Self-approval attempt');
    expect(result).toBeNull();
  });

  it('returns null for wrong home', async () => {
    const result = await assessmentRepo.signOff(snapshotIds[1], homeB, 'manager', 'Cross-home attempt');
    expect(result).toBeNull();
  });
});
