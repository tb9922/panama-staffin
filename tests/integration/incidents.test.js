/**
 * Integration tests for Incidents module — CRUD, freeze, addenda, soft delete.
 *
 * Validates: upsert/update, optimistic locking, freeze immutability,
 * append-only addenda, JSON columns, home isolation, pagination.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as incidentRepo from '../../repositories/incidentRepo.js';

let homeA, homeB;
const createdIds = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM incident_addenda WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'inc-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM incidents WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'inc-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'inc-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('inc-test-a', 'Incident Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('inc-test-b', 'Incident Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;
});

afterAll(async () => {
  for (const id of createdIds) {
    await pool.query('DELETE FROM incident_addenda WHERE incident_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM incidents WHERE id = $1', [id]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Upsert + Read ──────────────────────────────────────────────────────────

describe('Incidents: upsert and read', () => {
  let incId;

  it('creates an incident via upsert', async () => {
    const created = await incidentRepo.upsert(homeA, {
      date: '2026-01-15',
      time: '14:30',
      location: 'Main lounge',
      type: 'fall',
      severity: 'moderate',
      description: 'Resident fell from chair',
      person_affected: 'resident',
      person_affected_name: 'Test Resident',
      staff_involved: ['S001', 'S002'],
      immediate_action: 'First aid administered',
      medical_attention: true,
      hospital_attendance: false,
      reported_by: 'test-user',
    });

    expect(created).not.toBeNull();
    expect(created.id).toBeTruthy();
    incId = created.id;
    createdIds.push(incId);

    expect(created.severity).toBe('moderate');
    expect(created.type).toBe('fall');
    expect(created.description).toBe('Resident fell from chair');
    expect(created.medical_attention).toBe(true);
    expect(created.hospital_attendance).toBe(false);
  });

  it('reads by id', async () => {
    const found = await incidentRepo.findById(incId, homeA);
    expect(found).not.toBeNull();
    expect(found.id).toBe(incId);
    expect(found.location).toBe('Main lounge');
  });

  it('blocks cross-home read', async () => {
    const found = await incidentRepo.findById(incId, homeB);
    expect(found).toBeNull();
  });

  it('returns staff_involved as array', async () => {
    const found = await incidentRepo.findById(incId, homeA);
    expect(Array.isArray(found.staff_involved)).toBe(true);
    expect(found.staff_involved).toContain('S001');
    expect(found.staff_involved).toContain('S002');
  });

  it('increments version and updated_at on upsert conflict path', async () => {
    const before = await incidentRepo.findById(incId, homeA);
    const updated = await incidentRepo.upsert(homeA, {
      id: incId,
      date: '2026-01-16',
      time: '15:00',
      location: 'Main lounge',
      type: 'fall',
      severity: 'serious',
      description: 'Resident fall updated through upsert path',
      person_affected: 'resident',
      person_affected_name: 'Test Resident',
      staff_involved: ['S001'],
      immediate_action: 'Updated action',
      medical_attention: true,
      hospital_attendance: false,
      reported_by: 'test-user',
    });

    expect(updated.version).toBe(before.version + 1);
    expect(updated.updated_at).not.toBe(before.updated_at);
    expect(updated.description).toBe('Resident fall updated through upsert path');
  });
});

// ── Update + Optimistic Locking ────────────────────────────────────────────

describe('Incidents: update and locking', () => {
  let incId;

  beforeAll(async () => {
    const created = await incidentRepo.upsert(homeA, {
      date: '2026-02-01',
      type: 'medication_error',
      severity: 'minor',
      description: 'Wrong dosage',
      reported_by: 'test-user',
    });
    incId = created.id;
    createdIds.push(incId);
  });

  it('updates with version increment', async () => {
    const found = await incidentRepo.findById(incId, homeA);
    const updated = await incidentRepo.update(incId, homeA,
      { severity: 'serious', investigation_status: 'under_review' },
      found.version
    );
    expect(updated).not.toBeNull();
    expect(updated.severity).toBe('serious');
    expect(updated.investigation_status).toBe('under_review');
    expect(updated.version).toBe(found.version + 1);
  });

  it('returns null on stale version', async () => {
    const result = await incidentRepo.update(incId, homeA,
      { severity: 'minor' }, 1
    );
    expect(result).toBeNull();
  });
});

// ── JSON Columns ───────────────────────────────────────────────────────────

describe('Incidents: JSON column handling', () => {
  it('stores and retrieves witnesses', async () => {
    const created = await incidentRepo.upsert(homeA, {
      date: '2026-02-10',
      type: 'fall',
      severity: 'minor',
      description: 'Test witnesses',
      witnesses: [
        { name: 'Jane Doe', role: 'Carer', statement_summary: 'Saw the fall' },
        { name: 'John Smith', role: 'Visitor' },
      ],
      reported_by: 'test-user',
    });
    createdIds.push(created.id);

    const found = await incidentRepo.findById(created.id, homeA);
    expect(Array.isArray(found.witnesses)).toBe(true);
    expect(found.witnesses).toHaveLength(2);
    expect(found.witnesses[0].name).toBe('Jane Doe');
  });

  it('stores and retrieves corrective_actions', async () => {
    const created = await incidentRepo.upsert(homeA, {
      date: '2026-02-11',
      type: 'near_miss',
      severity: 'minor',
      description: 'Test corrective actions',
      corrective_actions: [
        { description: 'Review procedure', assigned_to: 'Manager', due_date: '2026-03-01', status: 'open' },
      ],
      reported_by: 'test-user',
    });
    createdIds.push(created.id);

    const found = await incidentRepo.findById(created.id, homeA);
    expect(Array.isArray(found.corrective_actions)).toBe(true);
    expect(found.corrective_actions[0].description).toBe('Review procedure');
  });
});

// ── Freeze + Addenda ───────────────────────────────────────────────────────

describe('Incidents: freeze and addenda', () => {
  let incId;

  beforeAll(async () => {
    const created = await incidentRepo.upsert(homeA, {
      date: '2026-03-01',
      type: 'abuse_allegation',
      severity: 'major',
      description: 'Safeguarding concern raised',
      cqc_notifiable: true,
      cqc_notification_type: 'abuse_allegation',
      reported_by: 'test-user',
    });
    incId = created.id;
    createdIds.push(incId);
  });

  it('freezes an incident', async () => {
    const before = await incidentRepo.findById(incId, homeA);
    const result = await incidentRepo.freeze(incId, homeA);
    expect(result).toBe(true);
    const after = await incidentRepo.findById(incId, homeA);
    expect(after.updated_at).not.toBe(before.updated_at);
  });

  it('confirms frozen status', async () => {
    const frozen = await incidentRepo.isFrozen(incId, homeA);
    expect(frozen).toBe(true);
  });

  it('blocks update to frozen incident', async () => {
    await expect(incidentRepo.update(incId, homeA,
      { severity: 'minor' }
    )).rejects.toThrow(/frozen/);
  });

  it('blocks delete of frozen incident', async () => {
    const result = await incidentRepo.softDelete(incId, homeA);
    expect(result).toBe(false);
  });

  it('allows addendum on frozen incident', async () => {
    const addendum = await incidentRepo.addAddendum(
      incId, homeA, 'Manager Smith', 'Investigation initiated by local authority'
    );
    expect(addendum).not.toBeNull();
    expect(addendum.author).toBe('Manager Smith');
    expect(addendum.content).toBe('Investigation initiated by local authority');
  });

  it('lists addenda ordered by creation', async () => {
    await incidentRepo.addAddendum(incId, homeA, 'Manager Smith', 'Second note');
    const addenda = await incidentRepo.getAddenda(incId, homeA);
    expect(addenda).toHaveLength(2);
    expect(addenda[0].content).toBe('Investigation initiated by local authority');
    expect(addenda[1].content).toBe('Second note');
  });

  it('treats soft-deleted incidents as not frozen', async () => {
    const created = await incidentRepo.upsert(homeA, {
      date: '2026-03-05',
      type: 'near_miss',
      severity: 'minor',
      description: 'Freeze visibility test',
      reported_by: 'test-user',
    });
    createdIds.push(created.id);
    await incidentRepo.freeze(created.id, homeA);
    await pool.query('UPDATE incidents SET deleted_at = NOW() WHERE id = $1 AND home_id = $2', [created.id, homeA]);

    const frozen = await incidentRepo.isFrozen(created.id, homeA);
    expect(frozen).toBe(false);
  });

  it('blocks addenda on soft-deleted incidents', async () => {
    const created = await incidentRepo.upsert(homeA, {
      date: '2026-03-06',
      type: 'fall',
      severity: 'minor',
      description: 'Deleted incident addendum test',
      reported_by: 'test-user',
    });
    createdIds.push(created.id);
    await pool.query('UPDATE incidents SET deleted_at = NOW() WHERE id = $1 AND home_id = $2', [created.id, homeA]);

    const addendum = await incidentRepo.addAddendum(created.id, homeA, 'Manager Smith', 'Should not save');
    expect(addendum).toBeNull();
  });
});

// ── CQC / RIDDOR Fields ───────────────────────────────────────────────────

describe('Incidents: CQC and RIDDOR fields', () => {
  it('stores CQC notification fields', async () => {
    const created = await incidentRepo.upsert(homeA, {
      date: '2026-03-10',
      type: 'death',
      severity: 'catastrophic',
      description: 'Expected death — notification required',
      cqc_notifiable: true,
      cqc_notification_type: 'death',
      cqc_notified: false,
      reported_by: 'test-user',
    });
    createdIds.push(created.id);

    expect(created.cqc_notifiable).toBe(true);
    expect(created.cqc_notification_type).toBe('death');
    expect(created.cqc_notified).toBe(false);
  });

  it('stores RIDDOR fields', async () => {
    const created = await incidentRepo.upsert(homeA, {
      date: '2026-03-11',
      type: 'fall',
      severity: 'serious',
      description: 'Staff fracture — RIDDOR reportable',
      person_affected: 'staff',
      riddor_reportable: true,
      riddor_category: 'specified_injury',
      riddor_reported: false,
      reported_by: 'test-user',
    });
    createdIds.push(created.id);

    expect(created.riddor_reportable).toBe(true);
    expect(created.riddor_category).toBe('specified_injury');
    expect(created.riddor_reported).toBe(false);
  });
});

// ── Pagination ─────────────────────────────────────────────────────────────

describe('Incidents: pagination', () => {
  it('returns { rows, total }', async () => {
    const result = await incidentRepo.findByHome(homeA);
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('respects limit and offset', async () => {
    const page1 = await incidentRepo.findByHome(homeA, { limit: 2, offset: 0 });
    const page2 = await incidentRepo.findByHome(homeA, { limit: 2, offset: 2 });
    expect(page1.rows.length).toBeLessThanOrEqual(2);
    // total stays the same across pages
    expect(page1.total).toBe(page2.total);
  });

  it('returns empty for other home', async () => {
    const result = await incidentRepo.findByHome(homeB);
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ── Soft Delete ────────────────────────────────────────────────────────────

describe('Incidents: soft delete', () => {
  let incId;

  beforeAll(async () => {
    const created = await incidentRepo.upsert(homeA, {
      date: '2026-04-01',
      type: 'near_miss',
      severity: 'minor',
      description: 'Test soft delete',
      reported_by: 'test-user',
    });
    incId = created.id;
    createdIds.push(incId);
  });

  it('soft-deletes and excludes from queries', async () => {
    const deleted = await incidentRepo.softDelete(incId, homeA);
    expect(deleted).toBe(true);

    const byId = await incidentRepo.findById(incId, homeA);
    expect(byId).toBeNull();
  });
});
