import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findOrCreateBySource } from '../../repositories/actionItemRepo.js';
import {
  buildAgencyOverrideAction,
  ensureAgencyOverrideAction,
} from '../../services/actionItemCreationService.js';

vi.mock('../../repositories/actionItemRepo.js', () => ({
  findOrCreateBySource: vi.fn(),
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
    vi.mocked(findOrCreateBySource).mockReset();
  });

  it('skips agency attempts that are not emergency overrides', async () => {
    const result = await ensureAgencyOverrideAction(
      7,
      emergencyAttempt({ emergency_override: false }),
      { actorId: 99, today: TODAY },
      { query: vi.fn() },
    );

    expect(result).toEqual({ item: null, created: false, skipped: true });
    expect(findOrCreateBySource).not.toHaveBeenCalled();
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
    vi.mocked(findOrCreateBySource).mockResolvedValue({ item, created: true });

    const result = await ensureAgencyOverrideAction(
      7,
      emergencyAttempt({ viable_internal_candidate_count: 0, linked_agency_shift_id: 55 }),
      { actorId: 99, today: TODAY },
      client,
    );

    expect(result).toEqual({ item, created: true });
    expect(findOrCreateBySource).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        source_type: 'agency_approval_attempt',
        source_id: '42',
        source_action_key: 'emergency_override_review',
        priority: 'medium',
      }),
      client,
    );
  });
});
