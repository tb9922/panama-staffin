import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock('../../repositories/overrideRepo.js', () => ({
  findByHome: vi.fn(),
}));

vi.mock('../../repositories/onboardingRepo.js', () => ({
  findByHome: vi.fn(),
}));

vi.mock('../../shared/roles.js', () => ({
  hasModuleAccess: vi.fn(() => true),
}));

vi.mock('../../lib/trainingEligibility.js', () => ({
  INTERNAL_BANK_BLOCKING_TRAINING_TYPE_IDS: ['fire-safety'],
  evaluateInternalBankTrainingEligibility: vi.fn(() => ({
    status: 'blocked',
    blockers: ['Fire Safety expired on 2026-01-01'],
  })),
}));

vi.mock('../../shared/rotation.js', async () => {
  const actual = await vi.importActual('../../shared/rotation.js');
  return {
    ...actual,
    getActualShift: vi.fn(() => ({ shift: 'OFF' })),
    checkWTRImpact: vi.fn(() => ({
      ok: true,
      warn: true,
      projectedHours: 46,
      message: 'Projected 46.0h this week',
    })),
  };
});

import { pool } from '../../db.js';
import * as overrideRepo from '../../repositories/overrideRepo.js';
import * as onboardingRepo from '../../repositories/onboardingRepo.js';
import * as trainingEligibility from '../../lib/trainingEligibility.js';
import * as rotation from '../../shared/rotation.js';
import { findCandidates } from '../../services/internalBankService.js';

describe('internalBankService candidate DTO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 10, slug: 'home-a', name: 'Home A', config: { edit_lock_pin: '2468' }, role_id: 'home_manager' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'staff-1',
          home_id: 10,
          home_slug: 'home-a',
          home_name: 'Home A',
          home_config: { edit_lock_pin: '2468', cycle_start_date: '2026-01-01' },
          name: 'Sensitive Candidate',
          role: 'Carer',
          team: 'Day A',
          pref: 'E',
          active: true,
          wtr_opt_out: false,
          contract_hours: 36,
          willing_extras: true,
          willing_other_homes: true,
          max_weekly_hours_topup: 8,
          max_travel_radius_km: 25,
          home_postcode: 'SW1A 1AA',
          internal_bank_status: 'available',
          internal_bank_notes: 'Only call after manager approves',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    overrideRepo.findByHome.mockResolvedValue({});
    onboardingRepo.findByHome.mockResolvedValue({
      'staff-1': {
        dbs_check: { status: 'pending' },
        right_to_work: { status: 'pending' },
      },
    });
  });

  it('returns a narrow, sanitized candidate DTO without config or HR secrets', async () => {
    const result = await findCandidates({
      targetHomeId: 10,
      username: 'manager',
      role: 'Carer',
      shiftDate: '2026-05-04',
      shiftCode: 'AG-E',
      hours: 8,
    });

    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    expect(candidate.home_config).toBeUndefined();
    expect(candidate.internal_bank_notes).toBeUndefined();
    expect(candidate.home_postcode).toBeUndefined();
    expect(candidate.contract_hours).toBeUndefined();
    expect(JSON.stringify(candidate)).not.toContain('2468');
    expect(JSON.stringify(candidate)).not.toContain('Only call');
    expect(candidate.blockers).toEqual(expect.arrayContaining([
      'Onboarding/compliance requirement not met',
      'Mandatory training requirement not met',
    ]));
    expect(candidate.warnings).toEqual(['Working time close to limit']);
  });

  it('uses the full target week when blocking WTR breaches', async () => {
    pool.query.mockReset();
    overrideRepo.findByHome.mockReset();
    onboardingRepo.findByHome.mockReset();
    trainingEligibility.evaluateInternalBankTrainingEligibility.mockReturnValue({ status: 'ok', blockers: [] });
    rotation.checkWTRImpact.mockReturnValue({
      ok: false,
      warn: true,
      projectedHours: 56,
      message: 'Projected 56.0h this week - exceeds Working Time Regulations 48h limit.',
    });
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 10, slug: 'home-a', name: 'Home A', config: {}, role_id: 'home_manager' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'staff-2',
          home_id: 10,
          home_slug: 'home-a',
          home_name: 'Home A',
          home_config: { cycle_start_date: '2026-01-01' },
          name: 'WTR Candidate',
          role: 'Carer',
          active: true,
          willing_extras: true,
          willing_other_homes: false,
          internal_bank_status: 'available',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    overrideRepo.findByHome.mockResolvedValue({});
    onboardingRepo.findByHome.mockResolvedValue({
      'staff-2': {
        dbs_check: { status: 'completed' },
        right_to_work: { status: 'completed' },
      },
    });

    const result = await findCandidates({
      targetHomeId: 10,
      username: 'manager',
      role: 'Carer',
      shiftDate: '2026-05-07',
      shiftCode: 'AG-E',
      hours: 8,
    });

    expect(overrideRepo.findByHome).toHaveBeenCalledWith(10, '2026-05-04', '2026-05-10');
    expect(result.candidates[0].viable).toBe(false);
    expect(result.candidates[0].blockers).toContain('Working time limit would be exceeded');
  });

  it('checks Right to Work expiry against the requested shift date', async () => {
    pool.query.mockReset();
    overrideRepo.findByHome.mockReset();
    onboardingRepo.findByHome.mockReset();
    trainingEligibility.evaluateInternalBankTrainingEligibility.mockReturnValue({ status: 'ok', blockers: [] });
    rotation.checkWTRImpact.mockReturnValue({ ok: true, warn: false, projectedHours: 40, message: null });
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 10, slug: 'home-a', name: 'Home A', config: {}, role_id: 'home_manager' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'staff-3',
          home_id: 10,
          home_slug: 'home-a',
          home_name: 'Home A',
          home_config: { cycle_start_date: '2026-01-01' },
          name: 'RTW Candidate',
          role: 'Carer',
          active: true,
          willing_extras: true,
          willing_other_homes: false,
          internal_bank_status: 'available',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    overrideRepo.findByHome.mockResolvedValue({});
    onboardingRepo.findByHome.mockResolvedValue({
      'staff-3': {
        dbs_check: { status: 'completed' },
        right_to_work: { status: 'completed', expiry_date: '2026-05-06' },
      },
    });

    const result = await findCandidates({
      targetHomeId: 10,
      username: 'manager',
      role: 'Carer',
      shiftDate: '2026-05-07',
      shiftCode: 'AG-E',
      hours: 8,
    });

    expect(result.candidates[0].viable).toBe(false);
    expect(result.candidates[0].blockers).toContain('Onboarding/compliance requirement not met');
  });

  it('blocks active staff whose leaving date is before the requested shift', async () => {
    pool.query.mockReset();
    overrideRepo.findByHome.mockReset();
    onboardingRepo.findByHome.mockReset();
    trainingEligibility.evaluateInternalBankTrainingEligibility.mockReturnValue({ status: 'ok', blockers: [] });
    rotation.checkWTRImpact.mockReturnValue({ ok: true, warn: false, projectedHours: 40, message: null });
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 10, slug: 'home-a', name: 'Home A', config: {}, role_id: 'home_manager' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'staff-4',
          home_id: 10,
          home_slug: 'home-a',
          home_name: 'Home A',
          home_config: { cycle_start_date: '2026-01-01' },
          name: 'Leaver Candidate',
          role: 'Carer',
          active: true,
          leaving_date: '2026-05-01',
          willing_extras: true,
          willing_other_homes: false,
          internal_bank_status: 'available',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    overrideRepo.findByHome.mockResolvedValue({});
    onboardingRepo.findByHome.mockResolvedValue({
      'staff-4': {
        dbs_check: { status: 'completed' },
        right_to_work: { status: 'completed' },
      },
    });

    const result = await findCandidates({
      targetHomeId: 10,
      username: 'manager',
      role: 'Carer',
      shiftDate: '2026-05-07',
      shiftCode: 'AG-E',
      hours: 8,
    });

    expect(result.candidates[0].viable).toBe(false);
    expect(result.candidates[0].blockers).toContain('Eligibility requirement not met');
  });
});
