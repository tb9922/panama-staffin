/**
 * Integration tests for Onboarding module.
 *
 * Validates: upsertSection (deep merge), clearSection, findByHome,
 * cross-home isolation, section-level operations.
 *
 * Requires: PostgreSQL running with migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as onboardingRepo from '../../repositories/onboardingRepo.js';

let homeA, homeB;
const staffIds = [];

beforeAll(async () => {
  await pool.query(`DELETE FROM onboarding WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'onb-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE home_id IN (SELECT id FROM homes WHERE slug LIKE 'onb-test-%')`).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE slug LIKE 'onb-test-%'`);

  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('onb-test-a', 'Onboarding Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('onb-test-b', 'Onboarding Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;

  for (const s of [
    { id: 'ONB-S001', name: 'New Hire 1' },
    { id: 'ONB-S002', name: 'New Hire 2' },
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
  await pool.query(`DELETE FROM onboarding WHERE home_id IN ($1, $2)`, [homeA, homeB]).catch(() => {});
  for (const sid of staffIds) {
    await pool.query('DELETE FROM staff WHERE id = $1', [sid]).catch(() => {});
  }
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
});

// ── Upsert Section ──────────────────────────────────────────────────────────

describe('Onboarding: upsert section', () => {
  it('creates DBS check section', async () => {
    const result = await onboardingRepo.upsertSection(homeA, 'ONB-S001', 'dbs_check', {
      status: 'completed',
      certificate_number: 'DBS-2026-001',
      date_issued: '2026-01-10',
      checked_by: 'HR Manager',
    });

    expect(result.dbs_check).toBeDefined();
    expect(result.dbs_check.status).toBe('completed');
    expect(result.dbs_check.certificate_number).toBe('DBS-2026-001');
  });

  it('deep-merges additional section without overwriting existing', async () => {
    const result = await onboardingRepo.upsertSection(homeA, 'ONB-S001', 'right_to_work', {
      status: 'completed',
      document_type: 'UK Passport',
      expiry_date: '2036-05-15',
    });

    // Both sections should exist
    expect(result.dbs_check).toBeDefined();
    expect(result.dbs_check.status).toBe('completed');
    expect(result.right_to_work).toBeDefined();
    expect(result.right_to_work.document_type).toBe('UK Passport');
  });

  it('updates existing section in-place', async () => {
    const result = await onboardingRepo.upsertSection(homeA, 'ONB-S001', 'dbs_check', {
      status: 'completed',
      certificate_number: 'DBS-2026-002',
      date_issued: '2026-02-01',
      checked_by: 'Updated Manager',
    });

    expect(result.dbs_check.certificate_number).toBe('DBS-2026-002');
    expect(result.dbs_check.checked_by).toBe('Updated Manager');
    // Other sections preserved
    expect(result.right_to_work).toBeDefined();
  });
});

// ── Find By Home ────────────────────────────────────────────────────────────

describe('Onboarding: findByHome', () => {
  it('returns keyed by staffId', async () => {
    const result = await onboardingRepo.findByHome(homeA);
    expect(result['ONB-S001']).toBeDefined();
    expect(result['ONB-S001'].dbs_check).toBeDefined();
  });

  it('returns empty for other home', async () => {
    const result = await onboardingRepo.findByHome(homeB);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ── Clear Section ───────────────────────────────────────────────────────────

describe('Onboarding: clear section', () => {
  beforeAll(async () => {
    // Set up ONB-S002 with two sections
    await onboardingRepo.upsertSection(homeA, 'ONB-S002', 'references', {
      status: 'pending',
      ref1: { name: 'Previous Employer', received: false },
    });
    await onboardingRepo.upsertSection(homeA, 'ONB-S002', 'identity', {
      status: 'completed',
      photo_id_checked: true,
    });
  });

  it('clears a single section without affecting others', async () => {
    const result = await onboardingRepo.clearSection(homeA, 'ONB-S002', 'references');
    expect(result.references).toBeUndefined();
    expect(result.identity).toBeDefined();
    expect(result.identity.photo_id_checked).toBe(true);
  });

  it('returns null for non-existent staff', async () => {
    const result = await onboardingRepo.clearSection(homeA, 'ONB-NONEXISTENT', 'dbs_check');
    expect(result).toBeNull();
  });
});
