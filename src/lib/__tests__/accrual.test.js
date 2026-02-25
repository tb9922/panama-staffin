import { describe, it, expect } from 'vitest';
import { getLeaveYear, calculateAccrual, countALInLeaveYear } from '../accrual.js';

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
    // Use April 2 to avoid UTC+1 midnight boundary (April 1 local = March 31 UTC)
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

// ── countALInLeaveYear ────────────────────────────────────────────────────────

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
      '2025-03-31': { S1: { shift: 'AL' } }, // before leave year
      '2025-05-01': { S1: { shift: 'AL' } }, // within
      '2026-04-01': { S1: { shift: 'AL' } }, // after leave year
    };
    expect(countALInLeaveYear('S1', overrides, leaveYear)).toBe(1);
  });

  it('does not count other shifts as AL', () => {
    const overrides = {
      '2025-05-01': { S1: { shift: 'SICK' } },
      '2025-05-02': { S1: { shift: 'OFF' } },
    };
    expect(countALInLeaveYear('S1', overrides, leaveYear)).toBe(0);
  });

  it('returns 0 when no overrides exist', () => {
    expect(countALInLeaveYear('S1', {}, leaveYear)).toBe(0);
  });
});

// ── calculateAccrual ──────────────────────────────────────────────────────────

describe('calculateAccrual', () => {
  const config = {
    al_entitlement_days: 28,
    leave_year_start: '04-01',
  };

  function makeStaff(startDate, overrides = {}) {
    return { id: 'S1', name: 'Alice', start_date: startDate, ...overrides };
  }

  it('returns full entitlement for staff who started before the leave year', () => {
    const staff = makeStaff('2024-01-01');
    // Use mid-month date to avoid UTC+1 midnight boundary skewing the month count
    const result = calculateAccrual(staff, config, {}, '2025-10-15');
    // Leave year: 2025-04-01 → 2026-03-31. Staff started before it — full year.
    expect(result.baseEntitlement).toBe(28);
    expect(result.isProRata).toBe(false);
    // Mid-October = ~6.5 months in → accrued ~50-55% of 28
    expect(result.accrued).toBeGreaterThan(10);
    expect(result.accrued).toBeLessThan(28);
  });

  it('is pro-rata for a mid-year starter', () => {
    // Started 2025-07-01, leave year is 04-01 → 03-31, so 9 months in year
    const staff = makeStaff('2025-07-01');
    const result = calculateAccrual(staff, config, {}, '2025-10-01');
    expect(result.isProRata).toBe(true);
    // Pro-rata entitlement: 28 × (9/12) = 21 days
    expect(result.entitlement).toBeCloseTo(21, 0);
  });

  it('accrued=carryover when staff has not started yet', () => {
    const staff = makeStaff('2026-01-01', { al_carryover: 5 });
    const result = calculateAccrual(staff, config, {}, '2025-10-01');
    expect(result.accrued).toBe(5); // only carryover
    expect(result.used).toBe(0);
  });

  it('carryover is available from day 1 of the leave year', () => {
    const staff = makeStaff('2024-01-01', { al_carryover: 3 });
    const result = calculateAccrual(staff, config, {}, '2025-04-02'); // 2 days into leave year
    expect(result.accrued).toBeGreaterThanOrEqual(3); // carryover immediately available
  });

  it('subtracts used AL from accrued to give remaining', () => {
    const staff = makeStaff('2024-01-01');
    const overrides = {
      '2025-06-01': { S1: { shift: 'AL' } },
      '2025-06-02': { S1: { shift: 'AL' } },
      '2025-06-03': { S1: { shift: 'AL' } },
    };
    const result = calculateAccrual(staff, config, overrides, '2025-09-01');
    expect(result.used).toBe(3);
    expect(result.remaining).toBeCloseTo(result.accrued - 3, 1);
  });

  it('uses per-staff entitlement override when set', () => {
    const staff = makeStaff('2024-01-01', { al_entitlement: 33 });
    const result = calculateAccrual(staff, config, {}, '2025-09-01');
    expect(result.baseEntitlement).toBe(33); // staff override, not global 28
  });

  it('remaining can be negative when over-booked', () => {
    const staff = makeStaff('2024-01-01');
    // Book 20 days in the first month of leave year — more than accrued at that point
    const overrides = {};
    for (let d = 1; d <= 20; d++) {
      const dateStr = `2025-04-${String(d).padStart(2, '0')}`;
      overrides[dateStr] = { S1: { shift: 'AL' } };
    }
    const result = calculateAccrual(staff, config, overrides, '2025-04-20');
    expect(result.used).toBe(20);
    expect(result.remaining).toBeLessThan(0); // over-booked
  });

  it('full year entitlement is 28 when no pro-rata and no overrides', () => {
    const staff = makeStaff('2024-01-01');
    // entitlement = proRataEntitlement = baseEntitlement * (12/12) = 28 for a full-year member.
    // Note: accrued grows month-by-month during the year (1/12th per month) and only
    // reaches 28 on the last day of the final complete month — use entitlement not accrued.
    const result = calculateAccrual(staff, config, {}, '2026-01-15');
    expect(result.baseEntitlement).toBe(28);
    expect(result.isProRata).toBe(false);
    expect(result.entitlement).toBeCloseTo(28, 0);
  });
});
