/**
 * Integration tests for Training module (4 sub-resources).
 *
 * Validates: training records (upsert, findByHome, remove),
 * supervisions (upsert, findByHome, softDelete),
 * appraisals (upsert, findByHome, softDelete),
 * fire drills (upsert, findByHome, remove).
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as trainingRepo from '../../repositories/trainingRepo.js';
import * as supervisionRepo from '../../repositories/supervisionRepo.js';
import * as appraisalRepo from '../../repositories/appraisalRepo.js';
import * as fireDrillRepo from '../../repositories/fireDrillRepo.js';

let homeA, homeB;
const staffIds = [];

beforeAll(async () => {
  // Clean up previous test data
  await pool.query(`DELETE FROM training_records WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'trn-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM supervisions WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'trn-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM appraisals WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'trn-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM fire_drills WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'trn-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'trn-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'trn-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('trn-test-a', 'Training Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('trn-test-b', 'Training Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;

  // Create test staff for training linkage
  for (const s of [
    { id: 'TRN-S001', name: 'Test Carer 1', role: 'Carer', team: 'Day A' },
    { id: 'TRN-S002', name: 'Test Senior 1', role: 'Senior Carer', team: 'Day B' },
  ]) {
    await pool.query(
      `INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out, start_date)
       VALUES ($1, $2, $3, $4, $5, 'E', 1, 13.00, true, false, '2025-01-01')`,
      [s.id, homeA, s.name, s.role, s.team]
    );
    staffIds.push(s.id);
  }
});

afterAll(async () => {
  await pool.query(`DELETE FROM training_records WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  await pool.query(`DELETE FROM supervisions WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  await pool.query(`DELETE FROM appraisals WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  await pool.query(`DELETE FROM fire_drills WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  for (const sid of staffIds) {
    await pool.query('DELETE FROM staff WHERE id = $1', [sid]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Training Records ────────────────────────────────────────────────────────

describe('Training: training records', () => {
  let fireSafetyVersion;

  it('upserts a training record', async () => {
    const result = await trainingRepo.upsertRecord(homeA, 'TRN-S001', 'fire-safety', {
      completed: '2026-01-15',
      expiry: '2027-01-15',
      trainer: 'Jane Smith',
      method: 'classroom',
      certificate_ref: 'FS-042',
      level: null,
      notes: 'Passed practical assessment',
    });

    expect(result.completed).toBe('2026-01-15');
    expect(result.expiry).toBe('2027-01-15');
    expect(result.trainer).toBe('Jane Smith');
    expect(result.method).toBe('classroom');
    expect(result.certificate_ref).toBe('FS-042');
    expect(result.updated_at).toBeTruthy();
    fireSafetyVersion = result.updated_at;
  });

  it('upserts a second record for same staff different type', async () => {
    const result = await trainingRepo.upsertRecord(homeA, 'TRN-S001', 'moving-handling', {
      completed: '2026-02-01',
      expiry: '2027-02-01',
      trainer: 'Manual Handling Trainer',
      method: 'practical',
    });

    expect(result.completed).toBe('2026-02-01');
    expect(result.method).toBe('practical');
  });

  it('findByHome returns nested object { staffId: { typeId: record } }', async () => {
    const result = await trainingRepo.findByHome(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(2);

    expect(result.rows['TRN-S001']).toBeDefined();
    expect(result.rows['TRN-S001']['fire-safety']).toBeDefined();
    expect(result.rows['TRN-S001']['fire-safety'].completed).toBe('2026-01-15');
    expect(result.rows['TRN-S001']['moving-handling']).toBeDefined();
  });

  it('returns empty for other home', async () => {
    const result = await trainingRepo.findByHome(homeB);
    expect(result.total).toBe(0);
    expect(Object.keys(result.rows)).toHaveLength(0);
  });

  it('overwrites record on re-upsert (same staff + type)', async () => {
    const result = await trainingRepo.upsertRecord(homeA, 'TRN-S001', 'fire-safety', {
      completed: '2026-06-15',
      expiry: '2027-06-15',
      trainer: 'Updated Trainer',
      method: 'e-learning',
      _clientUpdatedAt: fireSafetyVersion,
    });

    expect(result.completed).toBe('2026-06-15');
    expect(result.trainer).toBe('Updated Trainer');
    expect(result.updated_at).not.toBe(fireSafetyVersion);
  });

  it('rejects stale training record updates', async () => {
    await expect(trainingRepo.upsertRecord(homeA, 'TRN-S001', 'fire-safety', {
      completed: '2026-08-01',
      expiry: '2027-08-01',
      trainer: 'Stale Writer',
      method: 'online',
      _clientUpdatedAt: fireSafetyVersion,
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects overwriting an existing training record without _clientUpdatedAt', async () => {
    await trainingRepo.upsertRecord(homeA, 'TRN-S001', 'infection-control', {
      completed: '2026-03-01',
      expiry: '2027-03-01',
      trainer: 'Initial Trainer',
      method: 'classroom',
    });

    await expect(trainingRepo.upsertRecord(homeA, 'TRN-S001', 'infection-control', {
      completed: '2026-03-15',
      expiry: '2027-03-15',
      trainer: 'Overwrite Attempt',
      method: 'online',
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('soft-deletes a training record', async () => {
    await trainingRepo.removeRecord(homeA, 'TRN-S001', 'moving-handling');

    const result = await trainingRepo.findByHome(homeA);
    expect(result.rows['TRN-S001']['moving-handling']).toBeUndefined();
  });
});

// ── Supervisions ────────────────────────────────────────────────────────────

describe('Training: supervisions', () => {
  const supId = 'sup-test-001';

  it('upserts a supervision session', async () => {
    const result = await supervisionRepo.upsertSession(homeA, 'TRN-S001', {
      id: supId,
      date: '2026-02-15',
      supervisor: 'Jane Manager',
      topics: 'Performance review, training needs',
      actions: 'Complete safeguarding L2 by March',
      next_due: '2026-04-01',
      notes: 'Good progress overall',
    });

    expect(result.id).toBe(supId);
    expect(result.date).toBe('2026-02-15');
    expect(result.supervisor).toBe('Jane Manager');
    expect(result.next_due).toBe('2026-04-01');
  });

  it('findByHome returns nested object { staffId: [sessions] }', async () => {
    const result = await supervisionRepo.findByHome(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);

    expect(result.rows['TRN-S001']).toBeDefined();
    expect(result.rows['TRN-S001']).toHaveLength(1);
    expect(result.rows['TRN-S001'][0].id).toBe(supId);
  });

  it('soft-deletes a supervision session', async () => {
    const deleted = await supervisionRepo.softDeleteSession(homeA, supId);
    expect(deleted).toBe(true);

    const result = await supervisionRepo.findByHome(homeA);
    expect(result.total).toBe(0);
  });

  it('rejects stale supervision updates', async () => {
    const fresh = await supervisionRepo.upsertSession(homeA, 'TRN-S001', {
      id: 'sup-test-stale',
      date: '2026-02-18',
      supervisor: 'Fresh Manager',
      topics: 'Fresh topics',
      actions: 'Fresh actions',
      next_due: '2026-04-18',
      notes: 'Fresh notes',
    });

    await supervisionRepo.upsertSession(homeA, 'TRN-S001', {
      id: 'sup-test-stale',
      date: '2026-02-19',
      supervisor: 'Updated Manager',
      topics: 'Updated topics',
      actions: 'Updated actions',
      next_due: '2026-04-19',
      notes: 'Updated notes',
      _clientUpdatedAt: fresh.updated_at,
    });

    await expect(supervisionRepo.upsertSession(homeA, 'TRN-S001', {
      id: 'sup-test-stale',
      date: '2026-02-20',
      supervisor: 'Stale Manager',
      topics: 'Stale topics',
      actions: 'Stale actions',
      next_due: '2026-04-20',
      notes: 'Stale notes',
      _clientUpdatedAt: fresh.updated_at,
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects overwriting an existing supervision without _clientUpdatedAt', async () => {
    await supervisionRepo.upsertSession(homeA, 'TRN-S001', {
      id: 'sup-test-no-token',
      date: '2026-03-01',
      supervisor: 'Initial Supervisor',
      topics: 'Initial topics',
      actions: 'Initial actions',
      next_due: '2026-05-01',
      notes: 'Initial notes',
    });

    await expect(supervisionRepo.upsertSession(homeA, 'TRN-S001', {
      id: 'sup-test-no-token',
      date: '2026-03-02',
      supervisor: 'Overwrite Supervisor',
      topics: 'Overwrite topics',
      actions: 'Overwrite actions',
      next_due: '2026-05-02',
      notes: 'Overwrite notes',
    })).rejects.toMatchObject({ statusCode: 409 });
  });
});

// ── Appraisals ──────────────────────────────────────────────────────────────

describe('Training: appraisals', () => {
  const aprId = 'apr-test-001';

  it('upserts an appraisal', async () => {
    const result = await appraisalRepo.upsertAppraisal(homeA, 'TRN-S002', {
      id: aprId,
      date: '2026-01-20',
      appraiser: 'John Manager',
      objectives: 'Improve medication competency',
      training_needs: 'Safeguarding L2, manual handling refresher',
      development_plan: 'Shadow senior carer for medication rounds',
      next_due: '2027-01-20',
      notes: 'Annual appraisal completed',
    });

    expect(result.id).toBe(aprId);
    expect(result.date).toBe('2026-01-20');
    expect(result.appraiser).toBe('John Manager');
    expect(result.next_due).toBe('2027-01-20');
  });

  it('findByHome returns nested object { staffId: [appraisals] }', async () => {
    const result = await appraisalRepo.findByHome(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);

    expect(result.rows['TRN-S002']).toBeDefined();
    expect(result.rows['TRN-S002']).toHaveLength(1);
    expect(result.rows['TRN-S002'][0].objectives).toBe('Improve medication competency');
  });

  it('soft-deletes an appraisal', async () => {
    const deleted = await appraisalRepo.softDeleteAppraisal(homeA, aprId);
    expect(deleted).toBe(true);

    const result = await appraisalRepo.findByHome(homeA);
    expect(result.total).toBe(0);
  });

  it('rejects stale appraisal updates', async () => {
    const fresh = await appraisalRepo.upsertAppraisal(homeA, 'TRN-S002', {
      id: 'apr-test-stale',
      date: '2026-01-25',
      appraiser: 'Fresh Appraiser',
      objectives: 'Fresh objectives',
      training_needs: 'Fresh needs',
      development_plan: 'Fresh plan',
      next_due: '2027-01-25',
      notes: 'Fresh notes',
    });

    await appraisalRepo.upsertAppraisal(homeA, 'TRN-S002', {
      id: 'apr-test-stale',
      date: '2026-01-26',
      appraiser: 'Updated Appraiser',
      objectives: 'Updated objectives',
      training_needs: 'Updated needs',
      development_plan: 'Updated plan',
      next_due: '2027-01-26',
      notes: 'Updated notes',
      _clientUpdatedAt: fresh.updated_at,
    });

    await expect(appraisalRepo.upsertAppraisal(homeA, 'TRN-S002', {
      id: 'apr-test-stale',
      date: '2026-01-27',
      appraiser: 'Stale Appraiser',
      objectives: 'Stale objectives',
      training_needs: 'Stale needs',
      development_plan: 'Stale plan',
      next_due: '2027-01-27',
      notes: 'Stale notes',
      _clientUpdatedAt: fresh.updated_at,
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects overwriting an existing appraisal without _clientUpdatedAt', async () => {
    await appraisalRepo.upsertAppraisal(homeA, 'TRN-S002', {
      id: 'apr-test-no-token',
      date: '2026-01-28',
      appraiser: 'Initial Appraiser',
      objectives: 'Initial objectives',
      training_needs: 'Initial needs',
      development_plan: 'Initial plan',
      next_due: '2027-01-28',
      notes: 'Initial notes',
    });

    await expect(appraisalRepo.upsertAppraisal(homeA, 'TRN-S002', {
      id: 'apr-test-no-token',
      date: '2026-01-29',
      appraiser: 'Overwrite Appraiser',
      objectives: 'Overwrite objectives',
      training_needs: 'Overwrite needs',
      development_plan: 'Overwrite plan',
      next_due: '2027-01-29',
      notes: 'Overwrite notes',
    })).rejects.toMatchObject({ statusCode: 409 });
  });
});

// ── Fire Drills ─────────────────────────────────────────────────────────────

describe('Training: fire drills', () => {
  const drillId = 'fd-test-001';

  it('upserts a fire drill', async () => {
    const result = await fireDrillRepo.upsertDrill(homeA, {
      id: drillId,
      date: '2026-02-01',
      time: '14:30',
      scenario: 'Kitchen fire — full evacuation',
      evacuation_time_seconds: 240,
      staff_present: ['TRN-S001', 'TRN-S002'],
      residents_evacuated: 28,
      issues: 'Fire door on first floor slow to close',
      corrective_actions: 'Maintenance to inspect door closer',
      conducted_by: 'Fire Marshal Jane',
      notes: 'All staff responded promptly',
    });

    expect(result.id).toBe(drillId);
    expect(result.date).toBe('2026-02-01');
    expect(result.time).toBe('14:30:00');
    expect(result.evacuation_time_seconds).toBe(240);
    expect(result.staff_present).toEqual(['TRN-S001', 'TRN-S002']);
    expect(result.residents_evacuated).toBe(28);
    expect(result.conducted_by).toBe('Fire Marshal Jane');
  });

  it('findByHome returns array of drills', async () => {
    const drills = await fireDrillRepo.findByHome(homeA);
    expect(Array.isArray(drills)).toBe(true);
    expect(drills.length).toBeGreaterThanOrEqual(1);
    expect(drills[0].id).toBe(drillId);
  });

  it('returns empty for other home', async () => {
    const drills = await fireDrillRepo.findByHome(homeB);
    expect(drills).toHaveLength(0);
  });

  it('soft-deletes a fire drill', async () => {
    const deleted = await fireDrillRepo.removeDrill(homeA, drillId);
    expect(deleted).toBe(true);

    const drills = await fireDrillRepo.findByHome(homeA);
    expect(drills).toHaveLength(0);
  });

  it('returns false for already-deleted drill', async () => {
    const deleted = await fireDrillRepo.removeDrill(homeA, drillId);
    expect(deleted).toBe(false);
  });

  it('rejects stale fire drill updates', async () => {
    const fresh = await fireDrillRepo.upsertDrill(homeA, {
      id: 'fd-test-stale',
      date: '2026-02-10',
      time: '09:00',
      scenario: 'Fresh drill',
      evacuation_time_seconds: 180,
      staff_present: ['TRN-S001'],
      residents_evacuated: 12,
      issues: 'None',
      corrective_actions: 'None',
      conducted_by: 'Fresh Lead',
      notes: 'Fresh notes',
    });

    await fireDrillRepo.upsertDrill(homeA, {
      id: 'fd-test-stale',
      date: '2026-02-11',
      time: '10:00',
      scenario: 'Updated drill',
      evacuation_time_seconds: 190,
      staff_present: ['TRN-S001', 'TRN-S002'],
      residents_evacuated: 13,
      issues: 'Updated issue',
      corrective_actions: 'Updated action',
      conducted_by: 'Updated Lead',
      notes: 'Updated notes',
      _clientUpdatedAt: fresh.updated_at,
    });

    await expect(fireDrillRepo.upsertDrill(homeA, {
      id: 'fd-test-stale',
      date: '2026-02-12',
      time: '11:00',
      scenario: 'Stale drill',
      evacuation_time_seconds: 200,
      staff_present: ['TRN-S002'],
      residents_evacuated: 14,
      issues: 'Stale issue',
      corrective_actions: 'Stale action',
      conducted_by: 'Stale Lead',
      notes: 'Stale notes',
      _clientUpdatedAt: fresh.updated_at,
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects overwriting an existing fire drill without _clientUpdatedAt', async () => {
    await fireDrillRepo.upsertDrill(homeA, {
      id: 'fd-test-no-token',
      date: '2026-02-13',
      time: '12:00',
      scenario: 'Initial no-token drill',
      evacuation_time_seconds: 210,
      staff_present: ['TRN-S001'],
      residents_evacuated: 15,
      issues: 'Initial issue',
      corrective_actions: 'Initial action',
      conducted_by: 'Initial Lead',
      notes: 'Initial notes',
    });

    await expect(fireDrillRepo.upsertDrill(homeA, {
      id: 'fd-test-no-token',
      date: '2026-02-14',
      time: '13:00',
      scenario: 'Overwrite no-token drill',
      evacuation_time_seconds: 220,
      staff_present: ['TRN-S002'],
      residents_evacuated: 16,
      issues: 'Overwrite issue',
      corrective_actions: 'Overwrite action',
      conducted_by: 'Overwrite Lead',
      notes: 'Overwrite notes',
    })).rejects.toMatchObject({ statusCode: 409 });
  });
});
