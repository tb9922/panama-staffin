import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIT_TASK_TEMPLATES } from '../../lib/auditTaskTemplates.js';

vi.mock('../../db.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from '../../db.js';
import {
  buildHomeSetupCompleteness,
  getHomeSetupCompletenessForUser,
} from '../../services/homeSetupService.js';

const TEMPLATE_KEYS = AUDIT_TASK_TEMPLATES.map((template) => template.key);

function completeHomeConfig() {
  return {
    home_name: 'Complete House',
    registered_beds: 2,
    cycle_start_date: '2026-04-01',
    required_modules: ['staff', 'training', 'governance', 'cqc_evidence'],
    shifts: {
      E: { hours: 8 },
      L: { hours: 8 },
      N: { hours: 10 },
    },
    minimum_staffing: {
      early: { heads: 1, skill_points: 1 },
      late: { heads: 1, skill_points: 1 },
      night: { heads: 1, skill_points: 1 },
    },
    training_types: [
      { id: 'fire', name: 'Fire Safety', active: true, roles: null },
      { id: 'meds', name: 'Medication', active: true, roles: ['Carer'] },
    ],
  };
}

describe('homeSetupService setup scoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 100% completion when every baseline is present', () => {
    const result = buildHomeSetupCompleteness(
      { id: 10, slug: 'complete-house', name: 'Complete House', config: completeHomeConfig(), role_id: 'home_manager' },
      {
        active_staff_count: 2,
        care_staff_count: 1,
        active_staff: [{ id: 'S001', role: 'Carer' }, { id: 'S002', role: 'Cook' }],
        bed_count: 2,
        occupied_beds: 1,
        available_beds: 1,
        audit_task_count: 20,
        audit_template_keys: TEMPLATE_KEYS,
        assigned_user_count: 2,
        cqc_evidence_count: 3,
        cqc_evidence_link_count: 2,
        cqc_evidence_statement_count: 4,
      },
    );

    expect(result.completion_pct).toBe(100);
    expect(result.completed_checks).toBe(result.total_checks);
    expect(result.missing_items).toEqual([]);
    expect(result.checks.training_baseline.details.required_training_slots).toBe(3);
  });

  it('surfaces clear missing items for an unconfigured home', () => {
    const result = buildHomeSetupCompleteness(
      { id: 11, slug: 'empty-house', name: 'Empty House', config: {} },
      {},
    );

    expect(result.completion_pct).toBe(0);
    expect(result.missing_items).toEqual(expect.arrayContaining([
      'Configure at least one active mandatory training type',
      'Set the rota cycle start date',
      'Add at least one active staff record',
      'Set registered beds in home config',
      'Create bed records for occupancy tracking',
      'Generate recurring audit tasks from templates',
      'Assign at least one active user to the home',
      'No required module baseline is configured',
      'Add at least one CQC evidence item or linked evidence record',
    ]));
  });

  it('keeps non-platform users scoped to homes returned by user_home_roles', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('FROM user_home_roles uhr') && text.includes('JOIN homes h')) {
        expect(params).toEqual(['manager']);
        expect(text).toContain('JOIN users u ON u.username = uhr.username AND u.active = true');
        return {
          rows: [
            { id: 21, slug: 'assigned-home', name: 'Assigned Home', config: completeHomeConfig(), role_id: 'viewer' },
          ],
        };
      }
      if (text.includes('FROM staff')) {
        return { rows: [{ home_id: 21, active_staff_count: 1, care_staff_count: 1, active_staff: [{ id: 'S001', role: 'Carer' }] }] };
      }
      if (text.includes('FROM beds')) {
        return { rows: [{ home_id: 21, bed_count: 2, occupied_beds: 1, available_beds: 1 }] };
      }
      if (text.includes('FROM audit_tasks')) {
        return { rows: [{ home_id: 21, audit_task_count: 10, audit_template_keys: TEMPLATE_KEYS }] };
      }
      if (text.includes('COUNT(DISTINCT uhr.username)')) {
        return { rows: [{ home_id: 21, assigned_user_count: 1 }] };
      }
      if (text.includes('FROM cqc_evidence')) {
        return { rows: [{ home_id: 21, cqc_evidence_count: 1, cqc_evidence_link_count: 0, cqc_evidence_statement_count: 1 }] };
      }
      throw new Error(`Unexpected query: ${text}`);
    });

    const result = await getHomeSetupCompletenessForUser({ username: ' Manager ', isPlatformAdmin: false });

    expect(result.homes.map((home) => home.home_slug)).toEqual(['assigned-home']);
    expect(result.homes[0].role_id).toBe('viewer');
  });

  it('allows platform admins to evaluate all active homes', async () => {
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT id, slug, name, config') && text.includes('FROM homes')) {
        expect(text).toContain('deleted_at IS NULL');
        return {
          rows: [
            { id: 31, slug: 'home-a', name: 'Home A', config: completeHomeConfig(), role_id: 'platform_admin' },
            { id: 32, slug: 'home-b', name: 'Home B', config: {}, role_id: 'platform_admin' },
          ],
        };
      }
      if (text.includes('FROM staff')) return { rows: [] };
      if (text.includes('FROM beds')) return { rows: [] };
      if (text.includes('FROM audit_tasks')) return { rows: [] };
      if (text.includes('COUNT(DISTINCT uhr.username)')) return { rows: [] };
      if (text.includes('FROM cqc_evidence')) return { rows: [] };
      throw new Error(`Unexpected query: ${text}`);
    });

    const result = await getHomeSetupCompletenessForUser({ username: 'admin', isPlatformAdmin: true });

    expect(result.summary.home_count).toBe(2);
    expect(result.homes.map((home) => home.home_slug).sort()).toEqual(['home-a', 'home-b']);
  });
});
