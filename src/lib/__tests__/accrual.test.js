import { describe, it, expect } from 'vitest';
import { getLeaveYear, calculateAccrual, countALInLeaveYear, sumALHoursInLeaveYear } from '../accrual.js';

// ── getLeaveYear ───────────────────────────────────────────────────────────────

describe('getLeaveYear', () => {
  it('returns correct leave year for UK tax year (04-01) — date within year', () => {
    const ly = getLeaveYear('2025-06-15', '04-01');
    expect(ly.startStr).toBe('2025-04-01');
    expect(ly.endStr).toBe('2026-03-31');
  });

  it('returns correct leave year for date before April 1', () => {
    const ly = getLeaveYear('2025-02-10', '04-01');
    expect(ly.startStr).toBe('2024-04-01');
    expect(ly.endStr).toBe('2025-03-31');
  });

  it('returns correct leave year for Jan 1 start', () => {
    const ly = getLeaveYear('2025-06-01', '01-01');
    expect(ly.startStr).toBe('2025-01-01');
    expect(ly.endStr).toBe('2025-12-31');
  });

  it('returns correct leave year when date is exactly on the start', () => {
    const ly = getLeaveYear('2025-04-02', '04-01');
    expect(ly.startStr).toBe('2025-04-01');
    expect(ly.endStr).toBe('2026-03-31');
  });

  it('handles leap year end dates correctly (Jan 1 year ending Dec 31 of a leap year)', () => {
    const ly = getLeaveYear('2024-06-15', '01-01');
    expect(ly.startStr).toBe('2024-01-01');
    expect(ly.endStr).toBe('2024-12-31');
  });
});

// ── countALInLeaveYear (legacy day-count) ────────────────────────────────────

describe('countALInLeaveYear', () => {
  const leaveYear = { startStr: '2025-04-01', endStr: '2026-03-31' };

  it('counts AL overrides within the leave year', () => {
    const overrides = {
      '2025-05-01': { S1: { shift: 'AL' }, S2: { shift: 'E' } },
      '2025-08-15': { S1: { shift: 'AL' } },
    };
    expect(countALInLeaveYear('S1', overrides, leaveYear)).toBe(2);
  });

  it('excludes AL outside the leave year', () => {
    const overrides = {
      '2025-03-31': { S1: { shift: 'AL' } },
      '2025-05-01': { S1: { shift: 'AL' } },
      '2026-04-01': { S1: { shift: 'AL' } },
    };
    expect(countALInLeaveYear('S1', overrides, leaveYear)).toBe(1);
  });

  it('returns 0 when no overrides exist', () => {
    expect(countALInLeaveYear('S1', {}, leaveYear)).toBe(0);
  });
});

// ── sumALHoursInLeaveYear ────────────────────────────────────────────────────

describe('sumALHoursInLeaveYear', () => {
  const leaveYear = { startStr: '2025-04-01', endStr: '2026-03-31' };
  const config = {
    cycle_start_date: '2025-01-06',
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
    leave_year_start: '04-01',
  };
  const staff = { id: 'S1', team: 'Day A', pref: 'EL', contract_hours: 36, start_date: '2024-01-01' };

  it('sums stored al_hours when present', () => {
    const overrides = {
      '2025-05-01': { S1: { shift: 'AL', al_hours: 12 } },
      '2025-05-02': { S1: { shift: 'AL', al_hours: 12 } },
      '2025-05-03': { S1: { shift: 'AL', al_hours: 8 } },
    };
    expect(sumALHoursInLeaveYear(staff, overrides, leaveYear, config)).toBe(32);
  });

  it('derives hours from scheduled shift for legacy bookings (no al_hours)', () => {
    // Day A on 2025-05-02 = cycleDay 4 = EL (12h)
    const overrides = {
      '2025-05-02': { S1: { shift: 'AL' } }, // no al_hours — legacy
    };
    const result = sumALHoursInLeaveYear(staff, overrides, leaveYear, config);
    expect(result).toBe(12); // EL shift = 12h
  });

  it('handles mixed stored and legacy bookings', () => {
    const overrides = {
      '2025-05-07': { S1: { shift: 'AL', al_hours: 12 } }, // stored
      '2025-05-02': { S1: { shift: 'AL' } }, // legacy — cycleDay 4 = EL = 12h
    };
    const result = sumALHoursInLeaveYear(staff, overrides, leaveYear, config);
    expect(result).toBe(24); // 12 stored + 12 derived
  });

  it('ignores non-AL overrides', () => {
    const overrides = {
      '2025-05-01': { S1: { shift: 'SICK' } },
      '2025-05-02': { S1: { shift: 'E' } },
    };
    expect(sumALHoursInLeaveYear(staff, overrides, leaveYear, config)).toBe(0);
  });

  it('excludes AL outside the leave year', () => {
    const overrides = {
      '2025-03-15': { S1: { shift: 'AL', al_hours: 12 } }, // before
      '2025-05-01': { S1: { shift: 'AL', al_hours: 8 } },  // within
      '2026-04-15': { S1: { shift: 'AL', al_hours: 12 } }, // after
    };
    expect(sumALHoursInLeaveYear(staff, overrides, leaveYear, config)).toBe(8);
  });

  it('includes hourly annual leave adjustments in used hours', () => {
    const overrides = {
      '2025-05-01': { S1: { shift: 'AL', al_hours: 8 } },
    };
    const hourAdjustments = {
      '2025-05-03': { S1: { kind: 'annual_leave', hours: 3 } },
      '2025-05-04': { S1: { kind: 'paid_authorised_absence', hours: 2 } },
    };
    expect(sumALHoursInLeaveYear(staff, overrides, leaveYear, config, hourAdjustments)).toBe(11);
  });
});

// ── calculateAccrual (hours-based) ──────────────────────────────────────────

describe('calculateAccrual', () => {
  const config = {
    leave_year_start: '04-01',
    cycle_start_date: '2025-01-06',
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
  };

  function makeStaff(startDate, overrides = {}) {
    return { id: 'S1', name: 'Alice', start_date: startDate, contract_hours: 36, team: 'Day A', pref: 'EL', ...overrides };
  }

  it('returns hours-based entitlement: 5.6 x contract_hours', () => {
    const staff = makeStaff('2024-01-01');
    const result = calculateAccrual(staff, config, {}, '2025-10-15');
    // 5.6 × 36 = 201.6
    expect(result.annualEntitlementHours).toBeCloseTo(201.6, 1);
    expect(result.isProRata).toBe(false);
    expect(result.contractHours).toBe(36);
    expect(result.missingContractHours).toBe(false);
  });

  it('uses staff.al_entitlement override when set (hours)', () => {
    const staff = makeStaff('2024-01-01', { al_entitlement: 250 });
    const result = calculateAccrual(staff, config, {}, '2025-09-01');
    expect(result.annualEntitlementHours).toBe(250);
  });

  it('flags missingContractHours when contract_hours is null/0', () => {
    const staff = makeStaff('2024-01-01', { contract_hours: null });
    const result = calculateAccrual(staff, config, {}, '2025-09-01');
    expect(result.missingContractHours).toBe(true);
    expect(result.annualEntitlementHours).toBe(0);
  });

  it('is pro-rata for a mid-year starter', () => {
    const staff = makeStaff('2025-07-01');
    const result = calculateAccrual(staff, config, {}, '2025-10-01');
    expect(result.isProRata).toBe(true);
    // 9 months in year: 201.6 × (9/12) = 151.2
    expect(result.proRataEntitlementHours).toBeCloseTo(151.2, 0);
  });

  it('accruedHours=carryoverHours when staff has not started yet', () => {
    const staff = makeStaff('2026-01-01', { al_carryover: 40 });
    const result = calculateAccrual(staff, config, {}, '2025-10-01');
    expect(result.accruedHours).toBe(40); // only carryover
    expect(result.usedHours).toBe(0);
  });

  it('carryover is available from day 1 of the leave year', () => {
    const staff = makeStaff('2024-01-01', { al_carryover: 24 });
    const result = calculateAccrual(staff, config, {}, '2025-04-02');
    expect(result.accruedHours).toBeGreaterThanOrEqual(24); // carryover immediately available
  });

  it('subtracts used AL hours from accrued to give remaining', () => {
    const staff = makeStaff('2024-01-01');
    const overrides = {
      '2025-06-01': { S1: { shift: 'AL', al_hours: 12 } },
      '2025-06-02': { S1: { shift: 'AL', al_hours: 12 } },
      '2025-06-03': { S1: { shift: 'AL', al_hours: 12 } },
    };
    const result = calculateAccrual(staff, config, overrides, '2025-09-01');
    expect(result.usedHours).toBe(36);
    expect(result.remainingHours).toBeCloseTo(result.accruedHours - 36, 1);
  });

  it('treats hourly annual leave adjustments as used leave without affecting non-leave adjustments', () => {
    const staff = makeStaff('2024-01-01');
    const overrides = {
      '2025-06-01': { S1: { shift: 'AL', al_hours: 12 } },
    };
    const hourAdjustments = {
      '2025-06-02': { S1: { kind: 'annual_leave', hours: 3 } },
      '2025-06-03': { S1: { kind: 'paid_authorised_absence', hours: 2 } },
    };
    const result = calculateAccrual(staff, config, overrides, '2025-09-01', hourAdjustments);
    expect(result.usedHours).toBe(15);
    expect(result.remainingHours).toBeCloseTo(result.accruedHours - 15, 1);
  });

  it('remainingHours can be negative when over-booked', () => {
    const staff = makeStaff('2024-01-01');
    const overrides = {};
    for (let d = 1; d <= 20; d++) {
      const dateStr = `2025-04-${String(d).padStart(2, '0')}`;
      overrides[dateStr] = { S1: { shift: 'AL', al_hours: 12 } };
    }
    const result = calculateAccrual(staff, config, overrides, '2025-04-20');
    expect(result.usedHours).toBe(240); // 20 × 12
    expect(result.remainingHours).toBeLessThan(0);
  });

  it('calculates weeks fields correctly', () => {
    const staff = makeStaff('2024-01-01');
    const overrides = {
      '2025-06-01': { S1: { shift: 'AL', al_hours: 12 } },
    };
    const result = calculateAccrual(staff, config, overrides, '2025-09-01');
    // entitlementWeeks = 201.6 / 36 = 5.6
    expect(result.entitlementWeeks).toBeCloseTo(5.6, 1);
    // usedWeeks = 12 / 36 = 0.333...
    expect(result.usedWeeks).toBeCloseTo(0.3, 1);
  });

  it('full year totalEntitlementHours = annualEntitlement + carryover', () => {
    const staff = makeStaff('2024-01-01', { al_carryover: 16 });
    const result = calculateAccrual(staff, config, {}, '2026-01-15');
    expect(result.annualEntitlementHours).toBeCloseTo(201.6, 1);
    // totalEntitlement = proRata (full year = annual) + carryover
    expect(result.totalEntitlementHours).toBeCloseTo(201.6 + 16, 0);
  });
});
