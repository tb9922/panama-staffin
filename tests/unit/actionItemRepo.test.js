import { describe, expect, it, vi } from 'vitest';
import {
  findBoardPackExceptionsByHomeIds,
  findByHome,
  findOrCreateBySource,
  syncBySource,
} from '../../repositories/actionItemRepo.js';

function actionRow(overrides = {}) {
  return {
    id: 123,
    home_id: 7,
    source_type: 'agency_approval_attempt',
    source_id: '42',
    source_action_key: 'emergency_override_review',
    title: 'Review emergency agency override',
    description: null,
    category: 'staffing',
    priority: 'high',
    owner_user_id: null,
    owner_name: null,
    owner_role: 'Home manager',
    due_date: '2026-05-03',
    status: 'open',
    evidence_required: true,
    evidence_notes: null,
    escalation_level: 1,
    escalated_at: null,
    completed_at: null,
    completed_by: null,
    verified_at: null,
    verified_by: null,
    created_by: 99,
    updated_by: 99,
    version: 1,
    created_at: '2026-05-04T10:00:00.000Z',
    updated_at: '2026-05-04T10:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function sourceAction() {
  return {
    source_type: 'agency_approval_attempt',
    source_id: 42,
    source_action_key: 'emergency_override_review',
    title: 'Review emergency agency override',
    category: 'staffing',
    priority: 'high',
    owner_role: 'Home manager',
    due_date: '2026-05-03',
    evidence_required: true,
    escalation_level: 1,
    created_by: 99,
  };
}

describe('action item repo source creation', () => {
  it('inserts source actions with an idempotent conflict target', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [actionRow()] })),
    };

    const result = await findOrCreateBySource(7, sourceAction(), client);

    expect(result.created).toBe(true);
    expect(result.item.source_id).toBe('42');
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toContain('ON CONFLICT (home_id, source_type, source_id, source_action_key)');
    expect(client.query.mock.calls[0][1]).toContain('42');
  });

  it('returns the existing source action when the insert conflicts', async () => {
    const existing = actionRow({ id: 456 });
    const client = {
      query: vi.fn(async (sql) => {
        if (sql.includes('INSERT INTO action_items')) return { rows: [] };
        return { rows: [existing] };
      }),
    };

    const result = await findOrCreateBySource(7, sourceAction(), client);

    expect(result).toMatchObject({
      created: false,
      item: { id: 456, source_action_key: 'emergency_override_review' },
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it('syncs existing source actions when upstream agency attempts change', async () => {
    const existing = actionRow({
      id: 456,
      title: 'Review emergency agency override: AG-N',
      description: 'No linked agency shift recorded',
      priority: 'high',
    });
    const updated = actionRow({
      id: 456,
      title: 'Review emergency agency override: AG-N Senior carer',
      description: 'Linked agency shift: 55',
      priority: 'medium',
      version: 2,
    });
    const client = {
      query: vi.fn(async (sql) => {
        if (sql.includes('INSERT INTO action_items')) return { rows: [] };
        if (sql.includes('UPDATE action_items')) return { rows: [updated], rowCount: 1 };
        return { rows: [existing] };
      }),
    };

    const result = await syncBySource(7, {
      ...sourceAction(),
      title: 'Review emergency agency override: AG-N Senior carer',
      description: 'Linked agency shift: 55',
      priority: 'medium',
    }, 99, client);

    expect(result).toMatchObject({
      created: false,
      updated: true,
      item: { id: 456, priority: 'medium', version: 2 },
    });
    const updateCall = client.query.mock.calls.find(([sql]) => sql.includes('UPDATE action_items'));
    expect(updateCall[0]).toContain('version = version + 1');
    expect(updateCall[1]).toEqual(expect.arrayContaining([
      'Review emergency agency override: AG-N Senior carer',
      'Linked agency shift: 55',
      'medium',
      99,
    ]));
  });

  it('uses assigned user display names for owner labels in action lists', async () => {
    const client = {
      query: vi.fn(async () => ({
        rows: [{
          ...actionRow({ owner_user_id: 77, owner_name: null, owner_role: null }),
          owner_display_name: 'Dana Manager',
          owner_username: 'dana.manager',
          _total: '1',
        }],
      })),
    };

    const result = await findByHome(7, {}, client);

    expect(result.rows[0]).toMatchObject({
      owner_user_id: 77,
      owner_name: 'Dana Manager',
      owner_label: 'Dana Manager',
    });
  });

  it('finds board-pack high-risk and overdue exceptions with omitted counts', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        expect(sql).toContain("ai.priority IN ('high', 'critical')");
        expect(sql).toContain('ai.due_date < CURRENT_DATE');
        expect(sql.indexOf('WHEN ai.escalation_level >= 3')).toBeLessThan(
          sql.indexOf("CASE ai.priority WHEN 'critical'")
        );
        return {
          rows: [{
            ...actionRow({ owner_user_id: 77, owner_name: null, escalation_level: 1 }),
            home_slug: 'oak-house',
            home_name: 'Oak House',
            owner_display_name: 'Dana Manager',
            owner_username: 'dana.manager',
            _total: '3',
          }],
        };
      }),
    };

    const result = await findBoardPackExceptionsByHomeIds([7], 1, client);

    expect(result).toMatchObject({
      total: 3,
      omitted: 2,
      limit: 1,
      rows: [expect.objectContaining({
        home_name: 'Oak House',
        owner_name: 'Dana Manager',
        escalation_level: 1,
      })],
    });
  });
});
