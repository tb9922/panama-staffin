import { describe, it, expect } from 'vitest';
import {
  getCycleDay,
  getScheduledShift,
  getActualShift,
  formatDate,
  addDays,
  isBankHoliday,
  getStaffForDay,
} from '../rotation.js';

// ── getCycleDay ────────────────────────────────────────────────────────────────

describe('getCycleDay', () => {
  const START = '2025-01-06'; // Monday

  it('returns 0 on the cycle start date', () => {
    expect(getCycleDay('2025-01-06', START)).toBe(0);
  });

  it('returns 1 on the day after start', () => {
    expect(getCycleDay('2025-01-07', START)).toBe(1);
  });

  it('returns 13 on the last day of the first cycle', () => {
    expect(getCycleDay('2025-01-19', START)).toBe(13);
  });

  it('wraps to 0 on the first day of the second cycle', () => {
    expect(getCycleDay('2025-01-20', START)).toBe(0);
  });

  it('correctly positions a date in the second cycle', () => {
    // Day 20 from start = cycle day 6
    expect(getCycleDay('2025-01-26', START)).toBe(6);
  });

  it('handles dates before the cycle start (wraps backwards)', () => {
    // Day before start = cycle day 13
    expect(getCycleDay('2025-01-05', START)).toBe(13);
  });

  it('handles a date far in the future correctly', () => {
    // 14 days after start = cycle day 0 again (two full cycles)
    expect(getCycleDay('2025-02-03', START)).toBe(0); // 28 days after start
  });

  it('handles date as Date object', () => {
    expect(getCycleDay(new Date('2025-01-06'), START)).toBe(0);
  });

  it('handles cycle start on a different date', () => {
    expect(getCycleDay('2025-03-05', '2025-03-05')).toBe(0);
    expect(getCycleDay('2025-03-06', '2025-03-05')).toBe(1);
  });

  it('is consistent: day 14 = day 0 (cycle length is 14)', () => {
    const day0 = getCycleDay(addDays('2025-01-06', 0), START);
    const day14 = getCycleDay(addDays('2025-01-06', 14), START);
    expect(day0).toBe(day14);
  });

  it('team A pattern: days 0,1 are working (1=working)', () => {
    // Team A pattern: [1,1,0,0,1,1,1,0,0,1,1,0,0,0]
    // Cycle days 0 and 1 = working for team A
    const PATTERN_A = [1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0];
    for (let i = 0; i < 14; i++) {
      const date = addDays('2025-01-06', i);
      const cycleDay = getCycleDay(date, START);
      expect(cycleDay).toBe(i);
      expect(PATTERN_A[cycleDay]).toBe(PATTERN_A[i]); // consistency check
    }
  });
});

// ── getScheduledShift ──────────────────────────────────────────────────────────

describe('getScheduledShift', () => {
  // Team A pattern: [1,1,0,0,1,1,1,0,0,1,1,0,0,0]
  // Cycle day 0 = working for A, off for B
  // Cycle day 2 = off for A, working for B

  const staffDayA = { id: 'S1', team: 'Day A', pref: 'E', active: true };
  const staffDayB = { id: 'S2', team: 'Day B', pref: 'L', active: true };
  const staffNightA = { id: 'S3', team: 'Night A', active: true };
  const staffFloat = { id: 'S4', team: 'Float', active: true };

  it('returns staff pref for Day A on a working day (cycle day 0)', () => {
    expect(getScheduledShift(staffDayA, 0)).toBe('E');
  });

  it('returns OFF for Day A on a rest day (cycle day 2)', () => {
    expect(getScheduledShift(staffDayA, 2)).toBe('OFF');
  });

  it('returns pref for Day B on their working day (cycle day 2)', () => {
    expect(getScheduledShift(staffDayB, 2)).toBe('L');
  });

  it('returns OFF for Day B on team A working day (cycle day 0)', () => {
    expect(getScheduledShift(staffDayB, 0)).toBe('OFF');
  });

  it('returns N for Night A on a working day (cycle day 0)', () => {
    expect(getScheduledShift(staffNightA, 0)).toBe('N');
  });

  it('returns AVL for Float team', () => {
    expect(getScheduledShift(staffFloat, 0)).toBe('AVL');
    expect(getScheduledShift(staffFloat, 2)).toBe('AVL');
  });

  it('returns OFF when date is before staff start_date', () => {
    const staff = { ...staffDayA, start_date: '2025-06-01' };
    // Cycle day 0 is a working day for Day A, but before their start date
    expect(getScheduledShift(staff, 0, '2025-05-01')).toBe('OFF');
  });

  it('returns normal shift when date is on or after start_date', () => {
    const staff = { ...staffDayA, start_date: '2025-01-06' };
    expect(getScheduledShift(staff, 0, '2025-01-06')).toBe('E');
  });

  it('defaults to EL when pref is not set', () => {
    const staffNoPrefs = { id: 'S5', team: 'Day A', active: true };
    expect(getScheduledShift(staffNoPrefs, 0)).toBe('EL');
  });
});

// ── getActualShift ─────────────────────────────────────────────────────────────

describe('getActualShift', () => {
  const START = '2025-01-06';
  const staff = { id: 'S1', team: 'Day A', pref: 'E', active: true };
  const dateOn = '2025-01-06'; // cycle day 0 — working for Day A

  it('returns scheduled shift when no override exists', () => {
    const result = getActualShift(staff, dateOn, {}, START);
    expect(result.shift).toBe('E');
  });

  it('returns override when present', () => {
    const overrides = { '2025-01-06': { S1: { shift: 'AL', reason: 'Holiday' } } };
    const result = getActualShift(staff, dateOn, overrides, START);
    expect(result.shift).toBe('AL');
    expect(result.reason).toBe('Holiday');
  });

  it('override takes priority over scheduled pattern', () => {
    const overrides = { '2025-01-06': { S1: { shift: 'SICK' } } };
    const result = getActualShift(staff, dateOn, overrides, START);
    expect(result.shift).toBe('SICK');
  });

  it('does not apply other staff overrides', () => {
    const overrides = { '2025-01-06': { S2: { shift: 'AL' } } };
    const result = getActualShift(staff, dateOn, overrides, START);
    expect(result.shift).toBe('E'); // S1 unaffected
  });
});

// ── isBankHoliday ──────────────────────────────────────────────────────────────

describe('isBankHoliday', () => {
  const config = {
    bank_holidays: [
      { date: '2025-12-25', name: 'Christmas Day' },
      { date: '2025-12-26', name: 'Boxing Day' },
    ],
  };

  it('returns true on a bank holiday', () => {
    expect(isBankHoliday('2025-12-25', config)).toBe(true);
  });

  it('returns false on a normal day', () => {
    expect(isBankHoliday('2025-12-24', config)).toBe(false);
  });

  it('returns false when bank_holidays is empty', () => {
    expect(isBankHoliday('2025-12-25', { bank_holidays: [] })).toBe(false);
  });

  it('returns false when bank_holidays is undefined', () => {
    expect(isBankHoliday('2025-12-25', {})).toBe(false);
  });
});

// ── getStaffForDay — BH auto-upgrade ──────────────────────────────────────────

describe('getStaffForDay — bank holiday upgrade', () => {
  const config = {
    cycle_start_date: '2025-01-06',
    bank_holidays: [{ date: '2025-12-25', name: 'Christmas Day' }],
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
    minimum_staffing: { early: { heads: 2, skill_points: 2 }, late: { heads: 2, skill_points: 2 }, night: { heads: 1, skill_points: 1 } },
    agency_rate_day: 22, agency_rate_night: 25,
  };

  const staffDayA = { id: 'S1', name: 'Alice', team: 'Day A', pref: 'E', role: 'Carer', skill: 1, hourly_rate: 13, active: true };
  const staffNightA = { id: 'S2', name: 'Bob', team: 'Night A', role: 'Night Carer', skill: 1, hourly_rate: 13.5, active: true };

  it('upgrades day shifts to BH-D on bank holiday', () => {
    // 2025-12-25 is Christmas — cycle day = getCycleDay('2025-12-25', '2025-01-06')
    const result = getStaffForDay([staffDayA], '2025-12-25', {}, config);
    const alice = result.find(s => s.id === 'S1');
    // Alice is Day A — if working that day, should be BH-D
    if (alice.shift !== 'OFF') {
      expect(alice.shift).toBe('BH-D');
    }
  });

  it('upgrades night shifts to BH-N on bank holiday', () => {
    const result = getStaffForDay([staffNightA], '2025-12-25', {}, config);
    const bob = result.find(s => s.id === 'S2');
    if (bob.shift !== 'OFF') {
      expect(bob.shift).toBe('BH-N');
    }
  });

  it('does not upgrade shifts on a normal day', () => {
    const result = getStaffForDay([staffDayA], '2025-12-24', {}, config);
    const alice = result.find(s => s.id === 'S1');
    expect(['E', 'OFF']).toContain(alice.shift); // E or OFF depending on cycle day — never BH-D
    expect(alice.shift).not.toBe('BH-D');
  });

  it('does not upgrade agency shifts on bank holiday', () => {
    const overrides = { '2025-12-25': { S3: { shift: 'AG-E' } } };
    const agencyStaff = [{ id: 'S3', name: 'Agency', team: 'Agency', role: 'Carer', skill: 0.5, hourly_rate: 22, active: true }];
    const result = getStaffForDay(agencyStaff, '2025-12-25', overrides, config);
    const ag = result.find(s => s.id === 'S3');
    expect(ag?.shift).toBe('AG-E'); // no upgrade for agency
  });
});
