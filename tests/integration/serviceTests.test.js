/**
 * Integration tests for dashboardService, homeService, and auditService.
 *
 * These three services had zero test coverage. Tests hit the real database
 * to verify correct behaviour under normal and edge conditions.
 *
 * Requires: PostgreSQL running with all migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import * as dashboardService from '../../services/dashboardService.js';
import * as homeService from '../../services/homeService.js';
import * as auditService from '../../services/auditService.js';

// ── Test constants ──────────────────────────────────────────────────────────

const SLUG = 'test-svc-home';
const HOME_NAME = 'Service Test Home';

let homeId;

// ── Setup & Teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  await cleanup();

  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, $2, '{}') RETURNING id`,
    [SLUG, HOME_NAME],
  );
  homeId = home.id;

  // Add a staff member for dashboard/data queries
  await pool.query(
    `INSERT INTO staff (id, home_id, name, role, team, skill, hourly_rate, active, wtr_opt_out, al_carryover)
     VALUES ('svc-S001', $1, 'Test Staffer', 'Carer', 'Day A', 1, 13.00, true, false, 0)`,
    [homeId],
  );
});

afterAll(async () => {
  await cleanup();
});

async function cleanup() {
  const { rows } = await pool.query(`SELECT id FROM homes WHERE slug = $1`, [SLUG]);
  if (rows.length === 0) return;
  const hid = rows[0].id;

  // Clean child tables (order matters for FK constraints)
  for (const table of [
    'incidents', 'complaints', 'complaint_surveys', 'maintenance',
    'ipc_audits', 'risk_register', 'policy_reviews', 'whistleblowing_concerns',
    'dols', 'mca_assessments', 'care_certificates', 'fire_drills',
    'training_records', 'supervisions', 'appraisals', 'overrides',
    'day_notes', 'staff',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE home_id = $1`, [hid]).catch(() => {});
  }
  await pool.query(`DELETE FROM audit_log WHERE home_slug = $1`, [SLUG]).catch(() => {});
  await pool.query(`DELETE FROM homes WHERE id = $1`, [hid]);
}

// ═══════════════════════════════════════════════════════════════════════════
// dashboardService
// ═══════════════════════════════════════════════════════════════════════════

describe('dashboardService', () => {
  it('returns modules and alerts for an empty home', async () => {
    const result = await dashboardService.getDashboardSummary(homeId);

    expect(result).toHaveProperty('modules');
    expect(result).toHaveProperty('alerts');
    expect(Array.isArray(result.alerts)).toBe(true);

    // Modules should have all expected keys
    const expectedModules = [
      'incidents', 'complaints', 'maintenance', 'training',
      'supervisions', 'appraisals', 'fireDrills', 'ipc',
      'risks', 'policies', 'whistleblowing', 'dols', 'careCertificate',
    ];
    for (const key of expectedModules) {
      expect(result.modules).toHaveProperty(key);
    }
  });

  it('returns zero counts when no data exists', async () => {
    const { modules } = await dashboardService.getDashboardSummary(homeId);

    expect(modules.incidents.open).toBe(0);
    expect(modules.complaints.open).toBe(0);
    expect(modules.maintenance.total).toBe(0);
    expect(modules.training.expired).toBe(0);
    expect(modules.risks.total).toBe(0);
  });

  it('picks up overdue maintenance checks', async () => {
    await pool.query(
      `INSERT INTO maintenance (id, home_id, category, description, next_due)
       VALUES ('mnt-test-1', $1, 'PAT', 'Test PAT check', '2020-01-01')`,
      [homeId],
    );

    const { modules, alerts } = await dashboardService.getDashboardSummary(homeId);
    expect(modules.maintenance.overdue).toBe(1);
    expect(alerts.some(a => a.module === 'maintenance')).toBe(true);

    await pool.query(`DELETE FROM maintenance WHERE id = 'mnt-test-1'`);
  });

  it('picks up active IPC outbreaks', async () => {
    await pool.query(
      `INSERT INTO ipc_audits (id, home_id, audit_date, audit_type, outbreak)
       VALUES ('ipc-test-1', $1, '2025-06-01', 'general', '{"status": "confirmed", "type": "norovirus"}')`,
      [homeId],
    );

    const { modules } = await dashboardService.getDashboardSummary(homeId);
    expect(modules.ipc.activeOutbreaks).toBe(1);

    await pool.query(`DELETE FROM ipc_audits WHERE id = 'ipc-test-1'`);
  });

  it('picks up critical risks', async () => {
    await pool.query(
      `INSERT INTO risk_register (id, home_id, title, residual_risk, status)
       VALUES ('rsk-test-1', $1, 'Critical test risk', 20, 'open')`,
      [homeId],
    );

    const { modules, alerts } = await dashboardService.getDashboardSummary(homeId);
    expect(modules.risks.critical).toBe(1);
    expect(alerts.some(a => a.module === 'risks' && a.type === 'error')).toBe(true);

    await pool.query(`DELETE FROM risk_register WHERE id = 'rsk-test-1'`);
  });

  it('alerts are sorted by priority (errors before warnings before info)', async () => {
    await pool.query(
      `INSERT INTO risk_register (id, home_id, title, residual_risk, status)
       VALUES ('rsk-test-sort', $1, 'Critical risk', 20, 'open')`,
      [homeId],
    );
    await pool.query(
      `INSERT INTO policy_reviews (id, home_id, policy_name, next_review_due, status)
       VALUES ('pol-test-sort', $1, 'Test Policy', '2020-01-01', 'overdue')`,
      [homeId],
    );

    const { alerts } = await dashboardService.getDashboardSummary(homeId);
    const typeOrder = { error: 0, warning: 1, info: 2 };
    for (let i = 1; i < alerts.length; i++) {
      expect(typeOrder[alerts[i].type]).toBeGreaterThanOrEqual(typeOrder[alerts[i - 1].type]);
    }

    await pool.query(`DELETE FROM risk_register WHERE id = 'rsk-test-sort'`);
    await pool.query(`DELETE FROM policy_reviews WHERE id = 'pol-test-sort'`);
  });

  it('handles overdue policy reviews', async () => {
    await pool.query(
      `INSERT INTO policy_reviews (id, home_id, policy_name, next_review_due, status)
       VALUES ('pol-test-1', $1, 'Overdue Policy', '2020-01-01', 'overdue')`,
      [homeId],
    );

    const { modules } = await dashboardService.getDashboardSummary(homeId);
    expect(modules.policies.overdue).toBe(1);

    await pool.query(`DELETE FROM policy_reviews WHERE id = 'pol-test-1'`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// homeService
// ═══════════════════════════════════════════════════════════════════════════

describe('homeService', () => {
  describe('listHomes', () => {
    it('returns an array including the test home', async () => {
      const homes = await homeService.listHomes();
      expect(Array.isArray(homes)).toBe(true);
      // homeRepo.listAll maps slug to the `id` field
      expect(homes.some(h => h.id === SLUG)).toBe(true);
    });
  });

  describe('assembleData', () => {
    it('returns full payload for admin role', async () => {
      const data = await homeService.assembleData(SLUG, 'admin');

      expect(data).toHaveProperty('config');
      expect(data).toHaveProperty('staff');
      expect(data).toHaveProperty('overrides');
      expect(data).toHaveProperty('_updatedAt');
      expect(Array.isArray(data.staff)).toBe(true);
    });

    it('includes staff PII fields for admin', async () => {
      const data = await homeService.assembleData(SLUG, 'admin');
      const staff = data.staff.find(s => s.id === 'svc-S001');
      expect(staff).toBeTruthy();
      expect(staff).toHaveProperty('hourly_rate');
    });

    it('strips PII fields for viewer role', async () => {
      const data = await homeService.assembleData(SLUG, 'viewer');
      const staff = data.staff.find(s => s.id === 'svc-S001');
      expect(staff).toBeTruthy();
      // Viewer should NOT see hourly_rate, ni_number, date_of_birth
      expect(staff).not.toHaveProperty('hourly_rate');
      expect(staff).not.toHaveProperty('ni_number');
      expect(staff).not.toHaveProperty('date_of_birth');
      // But should see scheduling-relevant fields
      expect(staff).toHaveProperty('id');
      expect(staff).toHaveProperty('name');
      expect(staff).toHaveProperty('role');
      expect(staff).toHaveProperty('team');
    });

    it('throws NotFoundError for nonexistent home', async () => {
      await expect(
        homeService.assembleData('nonexistent-slug-xyz', 'admin'),
      ).rejects.toThrow('Home not found');
    });
  });

  describe('saveData', () => {
    it('saves config and returns new updatedAt', async () => {
      const result = await homeService.saveData(SLUG, {
        config: { home_name: 'Updated Name' },
      }, 'test-admin', null);

      expect(result).toHaveProperty('updatedAt');
      expect(result.updatedAt).toBeTruthy();
    });

    it('rejects stale updates with ConflictError', async () => {
      // Get current timestamp
      const data = await homeService.assembleData(SLUG, 'admin');
      const currentTimestamp = data._updatedAt;

      // Save once to advance the timestamp
      await homeService.saveData(SLUG, {
        config: { home_name: 'First Save' },
      }, 'test-admin', currentTimestamp);

      // Try to save again with the old timestamp — should conflict
      await expect(
        homeService.saveData(SLUG, {
          config: { home_name: 'Stale Save' },
        }, 'test-admin', currentTimestamp),
      ).rejects.toThrow('modified by someone else');
    });

    it('throws NotFoundError for nonexistent home', async () => {
      await expect(
        homeService.saveData('nonexistent-slug-xyz', {}, 'admin', null),
      ).rejects.toThrow('Home not found');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// auditService
// ═══════════════════════════════════════════════════════════════════════════

describe('auditService', () => {
  it('logs an audit entry without throwing', async () => {
    await expect(
      auditService.log('test_action', SLUG, 'test-user', { detail: 'integration test' }),
    ).resolves.not.toThrow();
  });

  it('getRecent returns logged entries', async () => {
    await auditService.log('svc_test_read', SLUG, 'test-reader', null);

    const entries = await auditService.getRecent(10, SLUG);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some(e => e.action === 'svc_test_read')).toBe(true);
  });

  it('getRecent without homeSlug returns all entries', async () => {
    const entries = await auditService.getRecent(5);
    expect(Array.isArray(entries)).toBe(true);
  });

  it('purgeOlderThan removes old entries', async () => {
    // Insert an old entry directly via the audit_log table
    await pool.query(
      `INSERT INTO audit_log (action, home_slug, user_name, ts)
       VALUES ('old_test_entry', $1, 'test', NOW() - INTERVAL '100 days')`,
      [SLUG],
    );

    const deleted = await auditService.purgeOlderThan(30, SLUG);
    expect(deleted).toBeGreaterThanOrEqual(1);
  });

  it('log swallows errors silently', async () => {
    // auditService.log wraps auditRepo.log in a try/catch —
    // it should never throw. We verify the contract here.
    await expect(
      auditService.log('test', SLUG, 'user', null),
    ).resolves.not.toThrow();
  });
});
