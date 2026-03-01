/**
 * Integration tests for payroll race condition fixes.
 *
 * Verifies:
 *   - findByIdForUpdate requires a transaction client
 *   - Row-level locking prevents concurrent calculate/approve races
 *   - Version-based optimistic locking catches stale updates
 *
 * Requires: PostgreSQL running with all migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as payrollRunRepo from '../../repositories/payrollRunRepo.js';

// ── Test constants ────────────────────────────────────────────────────────────

const SLUG          = 'test-payroll-race';
const HOME_NAME     = 'Payroll Race Condition Test Home';
const PERIOD_START  = '2025-12-01';
const PERIOD_END    = '2025-12-14';

let homeId;

// ── Setup & Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await cleanup();

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, $2, '{}') RETURNING id`,
    [SLUG, HOME_NAME],
  );
  homeId = home.id;
});

afterAll(async () => {
  await cleanup();
});

async function cleanup() {
  const { rows } = await pool.query(`SELECT id FROM homes WHERE slug = $1`, [SLUG]);
  if (rows.length === 0) return;
  const hid = rows[0].id;
  await pool.query(
    `DELETE FROM payroll_line_shifts WHERE payroll_line_id IN (
       SELECT pl.id FROM payroll_lines pl
       JOIN payroll_runs pr ON pr.id = pl.payroll_run_id WHERE pr.home_id = $1)`, [hid]);
  await pool.query(
    `DELETE FROM payroll_lines WHERE payroll_run_id IN (
       SELECT id FROM payroll_runs WHERE home_id = $1)`, [hid]);
  await pool.query(`DELETE FROM payroll_runs WHERE home_id = $1`, [hid]);
  await pool.query(`DELETE FROM homes WHERE id = $1`, [hid]);
}

let runCounter = 0;

/** Helper: create a draft payroll run with unique dates and return its id */
async function createDraftRun() {
  runCounter++;
  // Offset dates by runCounter months to avoid unique constraint on (home_id, period_start, period_end)
  const start = `2025-${String(runCounter).padStart(2, '0')}-01`;
  const end   = `2025-${String(runCounter).padStart(2, '0')}-14`;
  const { rows: [run] } = await pool.query(
    `INSERT INTO payroll_runs (home_id, period_start, period_end, pay_frequency)
     VALUES ($1, $2, $3, 'fortnightly') RETURNING id`,
    [homeId, start, end],
  );
  return run.id;
}

/** Helper: set a run to a specific status directly */
async function setRunStatus(runId, status) {
  await pool.query(
    `UPDATE payroll_runs SET status = $1 WHERE id = $2`,
    [status, runId],
  );
}

// ── findByIdForUpdate ─────────────────────────────────────────────────────────

describe('findByIdForUpdate', () => {
  it('throws when called without a transaction client', async () => {
    const runId = await createDraftRun();
    await expect(
      payrollRunRepo.findByIdForUpdate(runId, homeId, null),
    ).rejects.toThrow('findByIdForUpdate requires a transaction client');
  });

  it('returns the run when called with a transaction client', async () => {
    const runId = await createDraftRun();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const run = await payrollRunRepo.findByIdForUpdate(runId, homeId, client);
      expect(run).toBeTruthy();
      expect(run.id).toBe(runId);
      expect(run.status).toBe('draft');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('returns null for nonexistent run', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const run = await payrollRunRepo.findByIdForUpdate(999999, homeId, client);
      expect(run).toBeNull();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

// ── Row-level locking ─────────────────────────────────────────────────────────

describe('Row-level locking (FOR UPDATE)', () => {
  it('second transaction blocks until first commits', async () => {
    const runId = await createDraftRun();
    await setRunStatus(runId, 'calculated');

    const client1 = await pool.connect();
    const client2 = await pool.connect();

    try {
      // Transaction 1: lock the row
      await client1.query('BEGIN');
      const run1 = await payrollRunRepo.findByIdForUpdate(runId, homeId, client1);
      expect(run1.status).toBe('calculated');

      // Transaction 1: change status to approved
      await payrollRunRepo.updateStatus(runId, homeId, 'approved', { approved_by: 'tx1' }, client1, run1.version);

      // Transaction 2: try to lock the same row with a timeout
      // It should block. Use statement_timeout so it fails fast instead of hanging.
      await client2.query('BEGIN');
      await client2.query('SET LOCAL statement_timeout = 1000'); // 1 second

      // This should timeout because client1 holds the lock
      await expect(
        payrollRunRepo.findByIdForUpdate(runId, homeId, client2),
      ).rejects.toThrow();

      await client2.query('ROLLBACK');

      // Commit transaction 1
      await client1.query('COMMIT');

      // Now transaction 2 can read — status should be 'approved'
      const client3 = await pool.connect();
      try {
        await client3.query('BEGIN');
        const run3 = await payrollRunRepo.findByIdForUpdate(runId, homeId, client3);
        expect(run3.status).toBe('approved');
        await client3.query('ROLLBACK');
      } finally {
        client3.release();
      }
    } finally {
      // Ensure cleanup even on failure
      await client1.query('ROLLBACK').catch(() => {});
      await client2.query('ROLLBACK').catch(() => {});
      client1.release();
      client2.release();
    }
  });
});

// ── Optimistic locking (version) ──────────────────────────────────────────────

describe('Optimistic locking (version)', () => {
  it('updateTotals succeeds with correct version', async () => {
    const runId = await createDraftRun();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const run = await payrollRunRepo.findByIdForUpdate(runId, homeId, client);
      const result = await payrollRunRepo.updateTotals(runId, homeId, {
        total_gross: 1000, total_enhancements: 200, total_sleep_ins: 50, staff_count: 5,
      }, client, run.version);
      expect(result).toBeTruthy();
      expect(result.total_gross).toBe(1000);
      expect(result.version).toBe(run.version + 1);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('updateTotals returns null with stale version', async () => {
    const runId = await createDraftRun();

    // First update (version 1 → 2)
    const client1 = await pool.connect();
    try {
      await client1.query('BEGIN');
      const run = await payrollRunRepo.findByIdForUpdate(runId, homeId, client1);
      expect(run.version).toBe(1);
      await payrollRunRepo.updateTotals(runId, homeId, {
        total_gross: 500, total_enhancements: 100, total_sleep_ins: 0, staff_count: 3,
      }, client1, run.version);
      await client1.query('COMMIT');
    } finally {
      client1.release();
    }

    // Second update with stale version 1 (current is 2)
    const client2 = await pool.connect();
    try {
      await client2.query('BEGIN');
      const result = await payrollRunRepo.updateTotals(runId, homeId, {
        total_gross: 999, total_enhancements: 0, total_sleep_ins: 0, staff_count: 1,
      }, client2, 1); // stale version
      expect(result).toBeNull();
      await client2.query('ROLLBACK');
    } finally {
      client2.release();
    }
  });

  it('updateStatus succeeds with correct version', async () => {
    const runId = await createDraftRun();
    await setRunStatus(runId, 'calculated');
    // Reset version after setRunStatus (which doesn't increment version)
    const { rows: [before] } = await pool.query(
      `SELECT version FROM payroll_runs WHERE id = $1`, [runId],
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await payrollRunRepo.updateStatus(
        runId, homeId, 'approved', { approved_by: 'test' }, client, before.version,
      );
      expect(result).toBeTruthy();
      expect(result.status).toBe('approved');
      expect(result.version).toBe(before.version + 1);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('updateStatus returns null with stale version', async () => {
    const runId = await createDraftRun();
    await setRunStatus(runId, 'calculated');

    // Bump version via a real update
    await pool.query(
      `UPDATE payroll_runs SET version = version + 1 WHERE id = $1`, [runId],
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await payrollRunRepo.updateStatus(
        runId, homeId, 'approved', { approved_by: 'test' }, client, 1, // stale
      );
      expect(result).toBeNull();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
