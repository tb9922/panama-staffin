/**
 * Integration tests for Contracts CRUD — including termination flow.
 *
 * Validates: creation, update with numeric/date fields, termination workflow,
 * probation management, optimistic locking, and home isolation.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as hrRepo from '../../repositories/hrRepo.js';

let homeA, homeB;
const createdIds = [];
const staffIds = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM hr_contracts WHERE staff_id LIKE 'ctr-test-%'`).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE id LIKE 'ctr-test-%'`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'ctr-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('ctr-test-a', 'Contract Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('ctr-test-b', 'Contract Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;

  for (const sid of ['ctr-test-01', 'ctr-test-02', 'ctr-test-03']) {
    await pool.query(
      `INSERT INTO staff (id, home_id, name, role, team, skill, hourly_rate, active, wtr_opt_out, al_carryover)
       VALUES ($1, $2, $3, 'Carer', 'Day A', 1, 12.50, true, false, 0)`,
      [sid, homeA, `Staff ${sid}`]
    );
    staffIds.push(sid);
  }
});

afterAll(async () => {
  for (const id of createdIds) {
    await pool.query('DELETE FROM hr_contracts WHERE id = $1', [id]).catch(() => {});
  }
  for (const sid of staffIds) {
    await pool.query('DELETE FROM staff WHERE id = $1', [sid]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Create + Read ───────────────────────────────────────────────────────────

describe('Contracts: create and read', () => {
  let caseId;

  it('creates a contract with version=1', async () => {
    const created = await hrRepo.createContract(homeA, {
      staff_id: 'ctr-test-01',
      contract_type: 'permanent',
      contract_start_date: '2026-01-15',
      job_title: 'Senior Carer',
      hours_per_week: 37.5,
      hourly_rate: 14.50,
      pay_frequency: 'monthly',
      annual_leave_days: 28,
      notice_period_employer: '4 weeks',
      notice_period_employee: '4 weeks',
      probation_period_months: 6,
      probation_start_date: '2026-01-15',
      probation_end_date: '2026-07-15',
      status: 'active',
    });

    caseId = created.id;
    createdIds.push(caseId);

    expect(created).not.toBeNull();
    expect(created.version).toBe(1);
    expect(created.staff_id).toBe('ctr-test-01');
    expect(created.contract_type).toBe('permanent');
    expect(created.hours_per_week).toBe(37.5);
    expect(created.hourly_rate).toBe(14.50);
    expect(created.annual_leave_days).toBe(28);
    expect(created.status).toBe('active');
  });

  it('reads by id', async () => {
    const found = await hrRepo.findContractById(caseId, homeA);
    expect(found).not.toBeNull();
    expect(found.id).toBe(caseId);
    expect(found.job_title).toBe('Senior Carer');
  });

  it('blocks cross-home read', async () => {
    const found = await hrRepo.findContractById(caseId, homeB);
    expect(found).toBeNull();
  });
});

// ── Numeric Fields ──────────────────────────────────────────────────────────

describe('Contracts: numeric field handling', () => {
  it('preserves zero as a valid numeric value', async () => {
    const created = await hrRepo.createContract(homeA, {
      staff_id: 'ctr-test-02',
      contract_type: 'zero_hours',
      contract_start_date: '2026-02-01',
      hours_per_week: 0,
      hourly_rate: 12.21,
      status: 'active',
    });
    createdIds.push(created.id);

    expect(created.hours_per_week).toBe(0);
    expect(created.hourly_rate).toBe(12.21);
  });

  it('handles null numeric fields', async () => {
    const created = await hrRepo.createContract(homeA, {
      staff_id: 'ctr-test-03',
      contract_type: 'bank',
      contract_start_date: '2026-03-01',
      status: 'active',
    });
    createdIds.push(created.id);

    // hours_per_week and hourly_rate are nullable
    expect(created.hours_per_week).toBeNull();
    expect(created.hourly_rate).toBeNull();
  });
});

// ── Optimistic Locking ──────────────────────────────────────────────────────

describe('Contracts: optimistic locking', () => {
  let caseId;

  beforeAll(async () => {
    const created = await hrRepo.createContract(homeA, {
      staff_id: 'ctr-test-01',
      contract_type: 'permanent',
      contract_start_date: '2026-04-01',
      hours_per_week: 40,
      status: 'active',
    });
    caseId = created.id;
    createdIds.push(caseId);
  });

  it('increments version on update', async () => {
    const updated = await hrRepo.updateContract(caseId, homeA,
      { hours_per_week: 35 }, null, 1
    );
    expect(updated.version).toBe(2);
    expect(updated.hours_per_week).toBe(35);
  });

  it('returns null on stale version', async () => {
    const result = await hrRepo.updateContract(caseId, homeA,
      { hours_per_week: 20 }, null, 1
    );
    expect(result).toBeNull();
  });
});

// ── Termination Flow ────────────────────────────────────────────────────────

describe('Contracts: termination workflow', () => {
  let caseId;

  beforeAll(async () => {
    const created = await hrRepo.createContract(homeA, {
      staff_id: 'ctr-test-01',
      contract_type: 'permanent',
      contract_start_date: '2025-06-01',
      hours_per_week: 37.5,
      hourly_rate: 13.00,
      status: 'active',
    });
    caseId = created.id;
    createdIds.push(caseId);
  });

  it('updates with termination details', async () => {
    const updated = await hrRepo.updateContract(caseId, homeA, {
      termination_type: 'resignation',
      termination_date: '2026-03-31',
      termination_reason: 'Staff member relocating',
      notice_given_date: '2026-03-01',
      notice_given_by: 'employee',
      last_working_day: '2026-03-31',
      garden_leave: false,
      pilon: false,
      status: 'terminated',
    });

    expect(updated.termination_type).toBe('resignation');
    expect(updated.termination_date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(updated.status).toBe('terminated');
    expect(updated.garden_leave).toBe(false);
    expect(updated.pilon).toBe(false);
    expect(updated.last_working_day).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('adds exit interview details', async () => {
    const current = await hrRepo.findContractById(caseId, homeA);
    const updated = await hrRepo.updateContract(caseId, homeA, {
      exit_interview_date: '2026-03-25',
      exit_interview_notes: 'Good experience, recommends the home',
      references_agreed: true,
    }, null, current.version);

    expect(updated.exit_interview_date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(updated.exit_interview_notes).toBe('Good experience, recommends the home');
    expect(updated.references_agreed).toBeTruthy();
  });
});

// ── Probation Management ────────────────────────────────────────────────────

describe('Contracts: probation flow', () => {
  let caseId;

  beforeAll(async () => {
    const created = await hrRepo.createContract(homeA, {
      staff_id: 'ctr-test-02',
      contract_type: 'permanent',
      contract_start_date: '2025-09-01',
      probation_period_months: 6,
      probation_start_date: '2025-09-01',
      probation_end_date: '2026-03-01',
      status: 'active',
    });
    caseId = created.id;
    createdIds.push(caseId);
  });

  it('updates probation outcome to passed', async () => {
    const updated = await hrRepo.updateContract(caseId, homeA, {
      probation_outcome: 'passed',
      probation_confirmed_date: '2026-02-28',
      probation_confirmation_letter_sent: true,
    });

    expect(updated.probation_outcome).toBe('passed');
    expect(updated.probation_confirmed_date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(updated.probation_confirmation_letter_sent).toBe(true);
  });

  it('handles probation extension', async () => {
    const created = await hrRepo.createContract(homeA, {
      staff_id: 'ctr-test-03',
      contract_type: 'permanent',
      contract_start_date: '2025-10-01',
      probation_period_months: 6,
      probation_start_date: '2025-10-01',
      probation_end_date: '2026-04-01',
      status: 'active',
    });
    createdIds.push(created.id);

    const updated = await hrRepo.updateContract(created.id, homeA, {
      probation_outcome: 'extended',
      probation_extension_date: '2026-07-01',
      probation_extension_reason: 'Performance needs improvement',
    });

    expect(updated.probation_outcome).toBe('extended');
    expect(updated.probation_extension_date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(updated.probation_extension_reason).toBe('Performance needs improvement');
  });
});

// ── Pagination + Filters ────────────────────────────────────────────────────

describe('Contracts: pagination and filters', () => {
  it('returns { rows, total }', async () => {
    const result = await hrRepo.findContracts(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by staffId', async () => {
    const result = await hrRepo.findContracts(homeA, { staffId: 'ctr-test-01' });
    expect(result.rows.every(r => r.staff_id === 'ctr-test-01')).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by status', async () => {
    const result = await hrRepo.findContracts(homeA, { status: 'terminated' });
    expect(result.rows.every(r => r.status === 'terminated')).toBe(true);
  });

  it('returns empty for other home', async () => {
    const result = await hrRepo.findContracts(homeB);
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ── Soft Delete ─────────────────────────────────────────────────────────────

describe('Contracts: soft delete', () => {
  let caseId;

  beforeAll(async () => {
    const created = await hrRepo.createContract(homeA, {
      staff_id: 'ctr-test-01',
      contract_type: 'fixed_term',
      contract_start_date: '2026-06-01',
      contract_end_date: '2026-12-31',
      status: 'active',
    });
    caseId = created.id;
    createdIds.push(caseId);
  });

  it('soft-deleted contract excluded from queries', async () => {
    await pool.query(
      'UPDATE hr_contracts SET deleted_at = NOW() WHERE id = $1',
      [caseId]
    );

    const byId = await hrRepo.findContractById(caseId, homeA);
    expect(byId).toBeNull();
  });
});
