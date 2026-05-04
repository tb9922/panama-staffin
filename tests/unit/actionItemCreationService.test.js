import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelBySource, syncBySource } from '../../repositories/actionItemRepo.js';
import {
  buildAgencyOverrideAction,
  ensureAgencyOverrideAction,
} from '../../services/actionItemCreationService.js';

vi.mock('../../repositories/actionItemRepo.js', () => ({
  cancelBySource: vi.fn(),
  syncBySource: vi.fn(),
}));

const TODAY = new Date('2026-05-04T12:00:00Z');

function emergencyAttempt(overrides = {}) {
  return {
    id: 42,
    home_id: 7,
    gap_date: '2026-05-03',
    shift_code: 'AG-N',
    role_needed: 'Senior carer',
    reason: 'Night sickness left rota uncovered',
    internal_bank_candidate_count: 3,
    viable_internal_candidate_count: 1,
    emergency_override: true,
    emergency_override_reason: 'Manager approved agency despite internal option needing review',
    linked_agency_shift_id: null,
    ...overrides,
  };
}

describe('action item creation service', () => {
  beforeEach(() => {
    vi.mocked(cancelBySource).mockReset();
    vi.mocked(syncBySource).mockReset();
  });

  it('cancels source actions when agency attempts are no longer emergency overrides', async () => {
    const client = { query: vi.fn() };
    vi.mocked(cancelBySource).mockResolvedValue({ item: { id: 123, status: 'cancelled' }, cancelled: true });

    const result = await ensureAgencyOverrideAction(
      7,
      emergencyAttempt({ emergency_override: false }),
      { actorId: 99, today: TODAY },
      client,
    );

    expect(result).toMatchObject({ item: { id: 123, status: 'cancelled' }, created: false, skipped: true, cancelled: true });
    expect(cancelBySource).toHaveBeenCalledWith(
      7,
      'agency_approval_attempt',
      '42',
      'emergency_override_review',
      99,
      client,
    );
    expect(syncBySource).not.toHaveBeenCalled();
  });

  it('builds a critical accountable action for override abuse risk', () => {
    const action = buildAgencyOverrideAction(emergencyAttempt(), { actorId: 99, today: TODAY });

    expect(action).toMatchObject({
      source_type: 'agency_approval_attempt',
      source_id: '42',
      source_action_key: 'emergency_override_review',
      category: 'staffing',
      priority: 'critical',
      owner_role: 'Home manager',
      due_date: '2026-05-03',
      status: 'open',
      evidence_required: true,
      escalation_level: 2,
      created_by: 99,
      updated_by: 99,
    });
    expect(action.title).toBe('Review emergency agency override: AG-N Senior carer');
    expect(action.description).toContain('Viable internal candidates: 1');
    expect(action.description).toContain('No linked agency shift recorded');
  });

  it('creates through the repo using the stable source key', async () => {
    const client = { query: vi.fn() };
    const item = { id: 123, source_type: 'agency_approval_attempt' };
    vi.mocked(syncBySource).mockResolvedValue({ item, created: true, updated: false });

    const result = await ensureAgencyOverrideAction(
      7,
      emergencyAttempt({ viable_internal_candidate_count: 0, linked_agency_shift_id: 55 }),
      { actorId: 99, today: TODAY },
      client,
    );

    expect(result).toEqual({ item, created: true, updated: false });
    expect(syncBySource).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        source_type: 'agency_approval_attempt',
        source_id: '42',
        source_action_key: 'emergency_override_review',
        priority: 'medium',
      }),
      99,
      client,
    );
  });
});
