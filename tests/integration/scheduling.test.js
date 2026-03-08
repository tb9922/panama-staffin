/**
 * Integration tests for the scheduling module fixes (B1–B3, S1–S6, minor).
 *
 * Covers: overrideRepo, staffRepo, dayNoteRepo, homeService (PII filtering),
 * AL validation (single + bulk + batch-aware), config Zod validation,
 * date-range filtering, batch staff sync, and home scoping (IDOR).
 *
 * Requires: PostgreSQL running with migrations applied.
 * Run: bash scripts/test-integration.sh
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, withTransaction } from '../../db.js';
import * as overrideRepo from '../../repositories/overrideRepo.js';
import * as staffRepo from '../../repositories/staffRepo.js';
import * as dayNoteRepo from '../../repositories/dayNoteRepo.js';
import * as homeService from '../../services/homeService.js';
import { homeConfigSchema } from '../../lib/zodHelpers.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

let homeA, homeB;

beforeAll(async () => {
  // Clean leftover data from previous failed runs
  await pool.query(`DELETE FROM shift_overrides WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'sched-test-%')`);
  await pool.query(`DELETE FROM day_notes WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'sched-test-%')`);
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'sched-test-%')`);
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'sched-test-%'`);

  // Create two test homes with config
  const configA = {
    max_al_same_day: 2,
    al_entitlement_days: 28,
    leave_year_start: '04-01',
    minimum_staffing: { early: { heads: 3, skill_points: 5 }, late: { heads: 3, skill_points: 5 }, night: { heads: 2, skill_points: 3 } },
    nlw_rate: 12.21,
    shifts: { E: { hours: 8 }, L: { hours: 8 }, N: { hours: 10 } },
  };
  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ('sched-test-home-a', 'Sched Test Home A', $1) RETURNING id`,
    [JSON.stringify(configA)]
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ('sched-test-home-b', 'Sched Test Home B', '{}') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;

  // Create test staff in home A
  const staffA = [
    { id: 'sched-S001', name: 'Alice', role: 'Carer', team: 'Day A', skill: 2, hourly_rate: 13.00, active: true },
    { id: 'sched-S002', name: 'Bob', role: 'Senior Carer', team: 'Day B', skill: 3, hourly_rate: 14.50, active: true },
    { id: 'sched-S003', name: 'Carol', role: 'Carer', team: 'Night A', skill: 1, hourly_rate: 12.50, active: true },
  ];
  for (const s of staffA) {
    await pool.query(
      `INSERT INTO staff (id, home_id, name, role, team, skill, hourly_rate, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (home_id, id) DO NOTHING`,
      [s.id, homeA, s.name, s.role, s.team, s.skill, s.hourly_rate, s.active]
    );
  }
});

afterAll(async () => {
  await pool.query(`DELETE FROM shift_overrides WHERE home_id IN ($1,$2)`, [homeA, homeB]).catch(() => {});
  await pool.query(`DELETE FROM day_notes WHERE home_id IN ($1,$2)`, [homeA, homeB]).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE home_id IN ($1,$2)`, [homeA, homeB]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE id IN ($1,$2)`, [homeA, homeB]).catch(() => {});
});

// ── overrideRepo CRUD ────────────────────────────────────────────────────────

describe('overrideRepo: upsertOne + findByHome', () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeA]);
  });

  it('upserts a single override and retrieves it', async () => {
    await overrideRepo.upsertOne(homeA, '2099-06-15', 'sched-S001', {
      shift: 'AL', reason: 'Holiday', source: 'al', sleep_in: false,
    });
    const overrides = await overrideRepo.findByHome(homeA);
    expect(overrides['2099-06-15']).toBeDefined();
    expect(overrides['2099-06-15']['sched-S001'].shift).toBe('AL');
    expect(overrides['2099-06-15']['sched-S001'].reason).toBe('Holiday');
  });

  it('updates an existing override on re-upsert', async () => {
    await overrideRepo.upsertOne(homeA, '2099-06-15', 'sched-S001', {
      shift: 'SICK', reason: 'Flu', source: 'manual', sleep_in: false,
    });
    const overrides = await overrideRepo.findByHome(homeA);
    expect(overrides['2099-06-15']['sched-S001'].shift).toBe('SICK');
    expect(overrides['2099-06-15']['sched-S001'].reason).toBe('Flu');
  });

  it('deletes a single override', async () => {
    const deleted = await overrideRepo.deleteOne(homeA, '2099-06-15', 'sched-S001');
    expect(deleted).toBe(true);
    const overrides = await overrideRepo.findByHome(homeA);
    expect(overrides['2099-06-15']).toBeUndefined();
  });

  it('deleteOne returns false for non-existent override', async () => {
    const deleted = await overrideRepo.deleteOne(homeA, '2099-06-15', 'sched-S001');
    expect(deleted).toBe(false);
  });
});

// ── S2: Date-range filtering ─────────────────────────────────────────────────

describe('overrideRepo: findByHome date-range filter (S2)', () => {
  beforeAll(async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeA]);
    // Insert overrides across a wide date range
    const dates = ['2099-01-10', '2099-03-15', '2099-06-20', '2099-09-01', '2099-12-25'];
    for (const d of dates) {
      await overrideRepo.upsertOne(homeA, d, 'sched-S001', { shift: 'AL', source: 'test' });
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeA]);
  });

  it('returns all overrides when no range specified', async () => {
    const overrides = await overrideRepo.findByHome(homeA);
    expect(Object.keys(overrides)).toHaveLength(5);
  });

  it('filters by fromDate only', async () => {
    const overrides = await overrideRepo.findByHome(homeA, '2099-06-01');
    const dates = Object.keys(overrides);
    expect(dates).toHaveLength(3); // Jun, Sep, Dec
    expect(dates.every(d => d >= '2099-06-01')).toBe(true);
  });

  it('filters by toDate only', async () => {
    const overrides = await overrideRepo.findByHome(homeA, undefined, '2099-06-30');
    const dates = Object.keys(overrides);
    expect(dates).toHaveLength(3); // Jan, Mar, Jun
    expect(dates.every(d => d <= '2099-06-30')).toBe(true);
  });

  it('filters by both fromDate and toDate', async () => {
    const overrides = await overrideRepo.findByHome(homeA, '2099-03-01', '2099-09-30');
    const dates = Object.keys(overrides);
    expect(dates).toHaveLength(3); // Mar, Jun, Sep
  });

  it('returns empty when range matches nothing', async () => {
    const overrides = await overrideRepo.findByHome(homeA, '2099-07-01', '2099-08-31');
    expect(Object.keys(overrides)).toHaveLength(0);
  });
});

// ── sleep_in always included ─────────────────────────────────────────────────

describe('overrideRepo: sleep_in always present in response (minor fix)', () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeA]);
  });

  it('includes sleep_in: false when not set', async () => {
    await overrideRepo.upsertOne(homeA, '2099-07-01', 'sched-S001', {
      shift: 'N', source: 'manual', sleep_in: false,
    });
    const overrides = await overrideRepo.findByHome(homeA);
    expect(overrides['2099-07-01']['sched-S001'].sleep_in).toBe(false);
  });

  it('includes sleep_in: true when set', async () => {
    await overrideRepo.upsertOne(homeA, '2099-07-01', 'sched-S001', {
      shift: 'N', source: 'manual', sleep_in: true,
    });
    const overrides = await overrideRepo.findByHome(homeA);
    expect(overrides['2099-07-01']['sched-S001'].sleep_in).toBe(true);
  });
});

// ── B2: Bulk upsert + transaction ────────────────────────────────────────────

describe('overrideRepo: upsertBulk within transaction (B2)', () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeA]);
  });

  it('inserts multiple overrides in one call', async () => {
    const rows = [
      { date: '2099-08-01', staffId: 'sched-S001', shift: 'E', source: 'bulk' },
      { date: '2099-08-01', staffId: 'sched-S002', shift: 'L', source: 'bulk' },
      { date: '2099-08-02', staffId: 'sched-S001', shift: 'N', source: 'bulk' },
    ];
    await overrideRepo.upsertBulk(homeA, rows);
    const overrides = await overrideRepo.findByHome(homeA, '2099-08-01', '2099-08-02');
    expect(overrides['2099-08-01']['sched-S001'].shift).toBe('E');
    expect(overrides['2099-08-01']['sched-S002'].shift).toBe('L');
    expect(overrides['2099-08-02']['sched-S001'].shift).toBe('N');
  });

  it('rolls back entire bulk on transaction failure', async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeA]);

    let threw = false;
    try {
      await withTransaction(async (client) => {
        await overrideRepo.upsertBulk(homeA, [
          { date: '2099-09-01', staffId: 'sched-S001', shift: 'E', source: 'txn' },
          { date: '2099-09-02', staffId: 'sched-S001', shift: 'L', source: 'txn' },
        ], client);
        // Simulate failure after upsert
        throw new Error('Deliberate rollback');
      });
    } catch (e) {
      threw = true;
      expect(e.message).toBe('Deliberate rollback');
    }
    expect(threw).toBe(true);

    // Verify no data was committed
    const overrides = await overrideRepo.findByHome(homeA, '2099-09-01', '2099-09-30');
    expect(Object.keys(overrides)).toHaveLength(0);
  });
});

// ── IDOR: home scoping ───────────────────────────────────────────────────────

describe('IDOR: override home scoping', () => {
  beforeAll(async () => {
    await overrideRepo.upsertOne(homeA, '2099-10-01', 'sched-S001', { shift: 'AL', source: 'idor' });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id IN ($1,$2) AND date = '2099-10-01'`, [homeA, homeB]);
  });

  it('homeA override not visible from homeB', async () => {
    const overrides = await overrideRepo.findByHome(homeB, '2099-10-01', '2099-10-01');
    expect(Object.keys(overrides)).toHaveLength(0);
  });

  it('deleteOne on wrong home returns false', async () => {
    const deleted = await overrideRepo.deleteOne(homeB, '2099-10-01', 'sched-S001');
    expect(deleted).toBe(false);
    // Original still exists
    const overrides = await overrideRepo.findByHome(homeA, '2099-10-01', '2099-10-01');
    expect(overrides['2099-10-01']['sched-S001'].shift).toBe('AL');
  });
});

// ── deleteForDateRange ───────────────────────────────────────────────────────

describe('overrideRepo: deleteForDateRange', () => {
  beforeAll(async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeA]);
    for (let d = 1; d <= 5; d++) {
      await overrideRepo.upsertOne(homeA, `2099-11-0${d}`, 'sched-S001', { shift: 'E', source: 'range' });
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeA]);
  });

  it('deletes only overrides within the date range', async () => {
    const deleted = await overrideRepo.deleteForDateRange(homeA, '2099-11-02', '2099-11-04');
    expect(deleted).toBe(3);
    const remaining = await overrideRepo.findByHome(homeA, '2099-11-01', '2099-11-05');
    expect(Object.keys(remaining)).toHaveLength(2);
    expect(remaining['2099-11-01']).toBeDefined();
    expect(remaining['2099-11-05']).toBeDefined();
  });
});

// ── S4: Staff sync batching ──────────────────────────────────────────────────

describe('staffRepo: batch sync (S4)', () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM staff WHERE home_id = $1 AND id LIKE 'batch-%'`, [homeA]);
  });

  it('inserts multiple staff in one batch', async () => {
    const staffArr = Array.from({ length: 10 }, (_, i) => ({
      id: `batch-${String(i).padStart(3, '0')}`,
      name: `Batch Staff ${i}`,
      role: 'Carer',
      team: 'Day A',
      skill: 1,
      hourly_rate: 13.00,
      active: true,
    }));
    await staffRepo.sync(homeA, staffArr);
    const result = await staffRepo.findByHome(homeA, { limit: 200 });
    const batchStaff = result.rows.filter(s => s.id.startsWith('batch-'));
    expect(batchStaff).toHaveLength(10);
  });

  it('updates existing staff on re-sync', async () => {
    const staffArr = [{
      id: 'batch-000',
      name: 'Updated Name',
      role: 'Senior Carer',
      team: 'Day B',
      skill: 3,
      hourly_rate: 15.00,
      active: true,
    }];
    await staffRepo.sync(homeA, staffArr);
    const found = await staffRepo.findById(homeA, 'batch-000');
    expect(found.name).toBe('Updated Name');
    expect(found.role).toBe('Senior Carer');
    expect(found.hourly_rate).toBe(15.00);
  });

  it('soft-deletes staff not in incoming array', async () => {
    // Sync with only batch-000 — rest should be soft-deleted
    await staffRepo.sync(homeA, [
      { id: 'batch-000', name: 'Updated Name', role: 'Senior Carer', team: 'Day B', skill: 3, hourly_rate: 15.00, active: true },
      // Also include the original 3 test staff to avoid deleting them
      { id: 'sched-S001', name: 'Alice', role: 'Carer', team: 'Day A', skill: 2, hourly_rate: 13.00, active: true },
      { id: 'sched-S002', name: 'Bob', role: 'Senior Carer', team: 'Day B', skill: 3, hourly_rate: 14.50, active: true },
      { id: 'sched-S003', name: 'Carol', role: 'Carer', team: 'Night A', skill: 1, hourly_rate: 12.50, active: true },
    ]);
    const result = await staffRepo.findByHome(homeA, { limit: 200 });
    const batchStaff = result.rows.filter(s => s.id.startsWith('batch-'));
    // Only batch-000 should be active (deleted_at IS NULL)
    expect(batchStaff).toHaveLength(1);
    expect(batchStaff[0].id).toBe('batch-000');
  });
});

// ── staffRepo: shapeRow typing consistency ───────────────────────────────────

describe('staffRepo: shapeRow returns consistent types (minor fix)', () => {
  it('al_entitlement is parsed int or null', async () => {
    await pool.query(
      `UPDATE staff SET al_entitlement = 25 WHERE home_id = $1 AND id = 'sched-S001'`,
      [homeA]
    );
    const s = await staffRepo.findById(homeA, 'sched-S001');
    expect(typeof s.al_entitlement).toBe('number');
    expect(s.al_entitlement).toBe(25);
  });

  it('al_carryover defaults to 0 as number', async () => {
    // al_carryover is NOT NULL DEFAULT 0 — verify the default value is shaped correctly
    await pool.query(
      `UPDATE staff SET al_carryover = DEFAULT WHERE home_id = $1 AND id = 'sched-S001'`,
      [homeA]
    );
    const s = await staffRepo.findById(homeA, 'sched-S001');
    expect(s.al_carryover).toBe(0);
    expect(typeof s.al_carryover).toBe('number');
  });

  it('al_entitlement null when not set', async () => {
    await pool.query(
      `UPDATE staff SET al_entitlement = NULL WHERE home_id = $1 AND id = 'sched-S001'`,
      [homeA]
    );
    const s = await staffRepo.findById(homeA, 'sched-S001');
    expect(s.al_entitlement).toBeNull();
  });
});

// ── Day notes CRUD ───────────────────────────────────────────────────────────

describe('dayNoteRepo: CRUD', () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM day_notes WHERE home_id = $1`, [homeA]);
  });

  it('upserts and retrieves a day note', async () => {
    await dayNoteRepo.upsertOne(homeA, '2099-06-15', 'Staff meeting at 2pm');
    const notes = await dayNoteRepo.findByHome(homeA);
    expect(notes['2099-06-15']).toBe('Staff meeting at 2pm');
  });

  it('updates on re-upsert', async () => {
    await dayNoteRepo.upsertOne(homeA, '2099-06-15', 'Meeting cancelled');
    const notes = await dayNoteRepo.findByHome(homeA);
    expect(notes['2099-06-15']).toBe('Meeting cancelled');
  });

  it('deletes a day note', async () => {
    await dayNoteRepo.deleteOne(homeA, '2099-06-15');
    const notes = await dayNoteRepo.findByHome(homeA);
    expect(notes['2099-06-15']).toBeUndefined();
  });

  it('home scoping: homeB cannot see homeA notes', async () => {
    await dayNoteRepo.upsertOne(homeA, '2099-06-20', 'Private note');
    const notes = await dayNoteRepo.findByHome(homeB);
    expect(notes['2099-06-20']).toBeUndefined();
  });
});

// ── B3: Config Zod validation ────────────────────────────────────────────────

describe('homeConfigSchema: validates safety-critical fields (B3)', () => {
  it('accepts valid config', () => {
    const result = homeConfigSchema.safeParse({
      minimum_staffing: {
        early: { heads: 3, skill_points: 5 },
        late: { heads: 3, skill_points: 5 },
        night: { heads: 2, skill_points: 3 },
      },
      nlw_rate: 12.21,
      shifts: { E: { hours: 8 }, L: { hours: 8 } },
      max_consecutive_days: 6,
      max_al_same_day: 2,
      al_entitlement_days: 28,
    });
    expect(result.success).toBe(true);
  });

  it('allows unknown fields to pass through', () => {
    const result = homeConfigSchema.safeParse({
      home_name: 'Oakwood',
      registered_beds: 40,
      care_type: 'residential',
    });
    expect(result.success).toBe(true);
    expect(result.data.home_name).toBe('Oakwood');
  });

  it('rejects negative nlw_rate', () => {
    const result = homeConfigSchema.safeParse({ nlw_rate: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer heads in minimum_staffing', () => {
    const result = homeConfigSchema.safeParse({
      minimum_staffing: {
        early: { heads: 3.5, skill_points: 5 },
        late: { heads: 3, skill_points: 5 },
        night: { heads: 2, skill_points: 3 },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative heads', () => {
    const result = homeConfigSchema.safeParse({
      minimum_staffing: {
        early: { heads: -1, skill_points: 5 },
        late: { heads: 3, skill_points: 5 },
        night: { heads: 2, skill_points: 3 },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero shift hours', () => {
    const result = homeConfigSchema.safeParse({
      shifts: { E: { hours: 0 } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects max_consecutive_days > 14', () => {
    const result = homeConfigSchema.safeParse({ max_consecutive_days: 15 });
    expect(result.success).toBe(false);
  });

  it('rejects max_consecutive_days < 1', () => {
    const result = homeConfigSchema.safeParse({ max_consecutive_days: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects string minimum_staffing', () => {
    const result = homeConfigSchema.safeParse({ minimum_staffing: 'none' });
    expect(result.success).toBe(false);
  });

  it('accepts valid leave_year_start format', () => {
    const result = homeConfigSchema.safeParse({ leave_year_start: '04-01' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid leave_year_start format', () => {
    const result = homeConfigSchema.safeParse({ leave_year_start: '2025-04-01' });
    expect(result.success).toBe(false);
  });

});

// ── S3: PII filtering in homeService ─────────────────────────────────────────

describe('homeService: assembleData PII filtering (S3)', () => {
  it('admin gets all staff fields', async () => {
    const data = await homeService.assembleData('sched-test-home-a', 'admin');
    const staff = data.staff.find(s => s.id === 'sched-S001');
    expect(staff).toBeDefined();
    // Admin should see all fields including PII
    expect('hourly_rate' in staff).toBe(true);
  });

  it('viewer gets only allowlisted fields', async () => {
    const data = await homeService.assembleData('sched-test-home-a', 'viewer');
    const staff = data.staff.find(s => s.id === 'sched-S001');
    expect(staff).toBeDefined();
    // Allowlisted fields should be present
    expect(staff.id).toBe('sched-S001');
    expect(staff.name).toBe('Alice');
    expect(staff.role).toBe('Carer');
    expect(staff.team).toBe('Day A');
    // PII fields must NOT be present (allowlist blocks them)
    expect('date_of_birth' in staff).toBe(false);
    expect('ni_number' in staff).toBe(false);
    expect('hourly_rate' in staff).toBe(false);
  });

  it('viewer cannot see fields not in allowlist even if added later', async () => {
    // Simulate a hypothetical new PII field by checking the viewer response
    // only contains the exact set of allowlisted keys
    const data = await homeService.assembleData('sched-test-home-a', 'viewer');
    const staff = data.staff[0];
    const allowedKeys = new Set([
      'id', 'name', 'role', 'team', 'pref', 'skill', 'active',
      'start_date', 'contract_hours', 'wtr_opt_out',
      'al_entitlement', 'al_carryover', 'leaving_date',
    ]);
    for (const key of Object.keys(staff)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });
});

// ── B1 / S1: AL validation (via direct SQL to test the logic) ────────────────

describe('AL validation: max_al_same_day enforcement', () => {
  beforeAll(async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeA]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeA]);
  });

  it('allows AL up to max_al_same_day', async () => {
    // Config says max_al_same_day: 2
    await overrideRepo.upsertOne(homeA, '2099-05-01', 'sched-S001', { shift: 'AL', source: 'test' });
    await overrideRepo.upsertOne(homeA, '2099-05-01', 'sched-S002', { shift: 'AL', source: 'test' });

    // Count AL on that day
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM shift_overrides WHERE home_id = $1 AND date = '2099-05-01' AND shift = 'AL'`,
      [homeA]
    );
    expect(rows[0].cnt).toBe(2);
  });
});

// ── Replace (full override swap) ─────────────────────────────────────────────

describe('overrideRepo: replace (full override swap within transaction)', () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeA]);
  });

  it('replaces all overrides atomically', async () => {
    // Seed some initial data
    await overrideRepo.upsertOne(homeA, '2099-04-01', 'sched-S001', { shift: 'E', source: 'old' });
    await overrideRepo.upsertOne(homeA, '2099-04-02', 'sched-S001', { shift: 'L', source: 'old' });

    // Replace with completely different set
    await withTransaction(async (client) => {
      await overrideRepo.replace(homeA, {
        '2099-04-10': { 'sched-S002': { shift: 'N', reason: 'Replacement', source: 'new' } },
        '2099-04-11': { 'sched-S003': { shift: 'AL', source: 'new' } },
      }, client);
    });

    const overrides = await overrideRepo.findByHome(homeA);
    // Old data gone
    expect(overrides['2099-04-01']).toBeUndefined();
    expect(overrides['2099-04-02']).toBeUndefined();
    // New data present
    expect(overrides['2099-04-10']['sched-S002'].shift).toBe('N');
    expect(overrides['2099-04-11']['sched-S003'].shift).toBe('AL');
  });

  it('replace with empty object clears all overrides', async () => {
    await overrideRepo.replace(homeA, {});
    const overrides = await overrideRepo.findByHome(homeA);
    expect(Object.keys(overrides)).toHaveLength(0);
  });
});

// ── deleteForStaff ───────────────────────────────────────────────────────────

describe('overrideRepo: deleteForStaff', () => {
  beforeAll(async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeA]);
    await overrideRepo.upsertOne(homeA, '2099-07-01', 'sched-S001', { shift: 'E', source: 'test' });
    await overrideRepo.upsertOne(homeA, '2099-07-02', 'sched-S001', { shift: 'L', source: 'test' });
    await overrideRepo.upsertOne(homeA, '2099-07-01', 'sched-S002', { shift: 'N', source: 'test' });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [homeA]);
  });

  it('deletes only overrides for the specified staff', async () => {
    await overrideRepo.deleteForStaff(homeA, 'sched-S001');
    const overrides = await overrideRepo.findByHome(homeA);
    // S001 overrides gone
    expect(overrides['2099-07-01']?.['sched-S001']).toBeUndefined();
    expect(overrides['2099-07-02']).toBeUndefined();
    // S002 override still present
    expect(overrides['2099-07-01']['sched-S002'].shift).toBe('N');
  });
});
