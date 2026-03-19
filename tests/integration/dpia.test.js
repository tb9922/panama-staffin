/**
 * Integration tests for DPIA (Data Protection Impact Assessment) module.
 *
 * Validates: CRUD, optimistic locking, cross-home isolation, soft delete,
 * status workflow (screening → in_progress → completed → approved).
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as dpiaRepo from '../../repositories/dpiaRepo.js';

let homeA, homeB;

beforeAll(async () => {
  await pool.query(`DELETE FROM dpia_assessments WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'dpia-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'dpia-test-%'`);
  const { rows: [ha] } = await pool.query(`INSERT INTO homes (slug, name, config) VALUES ('dpia-test-a', 'DPIA Test A', '{}') RETURNING id`);
  const { rows: [hb] } = await pool.query(`INSERT INTO homes (slug, name, config) VALUES ('dpia-test-b', 'DPIA Test B', '{}') RETURNING id`);
  homeA = ha.id;
  homeB = hb.id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM dpia_assessments WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'dpia-test-%'`);
});

describe('DPIA: create and read', () => {
  let dpiaId;

  it('creates a DPIA with screening status', async () => {
    const result = await dpiaRepo.create(homeA, {
      title: 'Biometric clock-in system',
      processing_description: 'Fingerprint scanning for staff attendance',
      screening_result: 'required',
      high_risk_triggers: 'Biometric data (Art 9), systematic monitoring',
      legal_basis: 'legitimate_interests',
      created_by: 'admin',
    });
    expect(result).not.toBeNull();
    expect(result.id).toBeGreaterThan(0);
    dpiaId = result.id;
    expect(result.version).toBe(1);
    expect(result.status).toBe('screening');
    expect(result.screening_result).toBe('required');
    expect(result.title).toBe('Biometric clock-in system');
  });

  it('reads by id with home scoping', async () => {
    const result = await dpiaRepo.findById(dpiaId, homeA);
    expect(result).not.toBeNull();
    expect(result.processing_description).toBe('Fingerprint scanning for staff attendance');
  });

  it('returns null for wrong home (cross-home isolation)', async () => {
    const result = await dpiaRepo.findById(dpiaId, homeB);
    expect(result).toBeNull();
  });
});

describe('DPIA: status workflow with optimistic locking', () => {
  let dpia;

  beforeAll(async () => {
    dpia = await dpiaRepo.create(homeA, {
      title: 'CCTV in communal areas',
      processing_description: 'Video surveillance for resident safety',
      screening_result: 'required',
      created_by: 'admin',
    });
  });

  it('progresses screening → in_progress', async () => {
    const updated = await dpiaRepo.update(dpia.id, homeA, { status: 'in_progress' }, null, dpia.version);
    expect(updated).not.toBeNull();
    expect(updated.status).toBe('in_progress');
    expect(updated.version).toBe(dpia.version + 1);
    dpia = updated;
  });

  it('progresses in_progress → completed with risk assessment', async () => {
    const updated = await dpiaRepo.update(dpia.id, homeA, {
      status: 'completed',
      risk_assessment: 'Medium risk due to visible recording of vulnerable adults',
      risk_level: 'medium',
      measures: 'Signage, restricted access to footage, 30-day retention',
      residual_risk: 'low',
      necessity_assessment: 'Required for safeguarding — falls detection and abuse prevention',
    }, null, dpia.version);
    expect(updated).not.toBeNull();
    expect(updated.status).toBe('completed');
    expect(updated.risk_level).toBe('medium');
    expect(updated.residual_risk).toBe('low');
    dpia = updated;
  });

  it('progresses completed → approved', async () => {
    const updated = await dpiaRepo.update(dpia.id, homeA, {
      status: 'approved',
      approved_by: 'manager',
      approved_date: '2026-03-18',
    }, null, dpia.version);
    expect(updated).not.toBeNull();
    expect(updated.status).toBe('approved');
    expect(updated.approved_by).toBe('manager');
  });

  it('returns null on stale version (409 scenario)', async () => {
    const stale = await dpiaRepo.update(dpia.id, homeA, { notes: 'stale' }, null, 1);
    expect(stale).toBeNull();
  });
});

describe('DPIA: list', () => {
  it('lists DPIAs for home A', async () => {
    const result = await dpiaRepo.findAll(homeA);
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  it('returns empty for home B', async () => {
    const result = await dpiaRepo.findAll(homeB);
    expect(result.rows.length).toBe(0);
  });

  it('filters by status', async () => {
    const result = await dpiaRepo.findAll(homeA, { status: 'approved' });
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    for (const r of result.rows) expect(r.status).toBe('approved');
  });
});

describe('DPIA: soft delete', () => {
  it('soft deletes and hides record', async () => {
    const dpia = await dpiaRepo.create(homeA, {
      title: 'Delete test',
      processing_description: 'Test',
      created_by: 'admin',
    });
    const result = await dpiaRepo.softDelete(dpia.id, homeA);
    expect(result).not.toBeNull();
    expect(await dpiaRepo.findById(dpia.id, homeA)).toBeNull();
  });

  it('returns null for wrong home delete', async () => {
    const dpia = await dpiaRepo.create(homeA, {
      title: 'Cross-home test',
      processing_description: 'Test',
      created_by: 'admin',
    });
    expect(await dpiaRepo.softDelete(dpia.id, homeB)).toBeNull();
  });
});
