/**
 * Integration tests for IDOR (cross-home data access) fixes.
 *
 * These tests hit the real database to verify that repo functions
 * correctly scope queries to the requesting home's ID.
 *
 * Requires: PostgreSQL running with migrations applied.
 * Runs in CI via .github/workflows/test.yml (postgres service).
 * Locally: `docker compose up -d` + `node scripts/migrate.js` first.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as payrollRunRepo from '../../repositories/payrollRunRepo.js';
import * as hrRepo from '../../repositories/hrRepo.js';

// Test fixture IDs — set in beforeAll, cleaned up in afterAll
let homeA, homeB, payrollRunId, caseNoteId;

beforeAll(async () => {
  // Create two test homes
  const { rows: [ha] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('idor-test-home-a', 'IDOR Test Home A') RETURNING id`
  );
  const { rows: [hb] } = await pool.query(
    `INSERT INTO homes (slug, name) VALUES ('idor-test-home-b', 'IDOR Test Home B') RETURNING id`
  );
  homeA = ha.id;
  homeB = hb.id;

  // Insert a payroll run for home A
  const { rows: [run] } = await pool.query(
    `INSERT INTO payroll_runs (home_id, period_start, period_end, pay_frequency)
     VALUES ($1, '2099-01-01', '2099-01-31', 'monthly') RETURNING id`,
    [homeA]
  );
  payrollRunId = run.id;

  // Insert a case note for home A
  const { rows: [note] } = await pool.query(
    `INSERT INTO hr_case_notes (home_id, case_type, case_id, content, author)
     VALUES ($1, 'disciplinary', 999999, 'IDOR test note', 'test-admin') RETURNING id`,
    [homeA]
  );
  caseNoteId = note.id;
});

afterAll(async () => {
  // Clean up in reverse dependency order
  if (caseNoteId) await pool.query('DELETE FROM hr_case_notes WHERE id = $1', [caseNoteId]);
  if (payrollRunId) await pool.query('DELETE FROM payroll_runs WHERE id = $1', [payrollRunId]);
  if (homeA) await pool.query('DELETE FROM homes WHERE id = $1', [homeA]);
  if (homeB) await pool.query('DELETE FROM homes WHERE id = $1', [homeB]);
  await pool.end();
});

// ── payrollRunRepo.findById ───────────────────────────────────────────────────

describe('IDOR: payrollRunRepo.findById', () => {
  it('returns run when home_id matches', async () => {
    const run = await payrollRunRepo.findById(payrollRunId, homeA);
    expect(run).not.toBeNull();
    expect(run.id).toBe(payrollRunId);
    expect(run.home_id).toBe(homeA);
  });

  it('returns null when home_id does not match', async () => {
    const run = await payrollRunRepo.findById(payrollRunId, homeB);
    expect(run).toBeNull();
  });

  it('returns null for non-existent run ID', async () => {
    const run = await payrollRunRepo.findById(999999, homeA);
    expect(run).toBeNull();
  });
});

// ── payrollRunRepo.updateTotals ───────────────────────────────────────────────

describe('IDOR: payrollRunRepo.updateTotals', () => {
  const totals = { total_gross: 5000, total_enhancements: 500, total_sleep_ins: 100, staff_count: 10 };

  it('updates totals when home_id matches', async () => {
    const result = await payrollRunRepo.updateTotals(payrollRunId, homeA, totals);
    expect(result).not.toBeNull();
    expect(result.total_gross).toBe(5000);
    expect(result.staff_count).toBe(10);
    expect(result.status).toBe('calculated');
  });

  it('returns null when home_id does not match (no mutation)', async () => {
    const attackTotals = { total_gross: 0, total_enhancements: 0, total_sleep_ins: 0, staff_count: 0 };
    const result = await payrollRunRepo.updateTotals(payrollRunId, homeB, attackTotals);
    expect(result).toBeNull();

    // Verify original data untouched
    const run = await payrollRunRepo.findById(payrollRunId, homeA);
    expect(run.total_gross).toBe(5000);
  });
});

// ── hrRepo.findCaseNotes ──────────────────────────────────────────────────────

describe('IDOR: hrRepo.findCaseNotes', () => {
  it('returns notes when home_id matches', async () => {
    const notes = await hrRepo.findCaseNotes(homeA, 'disciplinary', 999999);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0].content).toBe('IDOR test note');
  });

  it('returns empty array when home_id does not match', async () => {
    const notes = await hrRepo.findCaseNotes(homeB, 'disciplinary', 999999);
    expect(notes).toHaveLength(0);
  });
});
