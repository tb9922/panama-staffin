import { describe, it, expect } from 'vitest';
import {
  getCycleDay,
  getScheduledShift,
  getActualShift,
  formatDate,
  parseDate,
  addDays,
  isBankHoliday,
  getStaffForDay,
  getShiftHours,
  calculateStaffPeriodHours,
  getALDeductionHours,
  getLeaveYear,
  STATUTORY_WEEKS,
  getStaffStatus,
  ROTATION_PRESETS,
  DEFAULT_PATTERN,
  CYCLE_LENGTH,
  resolvePattern,
  resolveCycleLength,
  isValidTeamsShape,
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

// ── Custom rotation patterns ──────────────────────────────────────────────────

describe('rotation presets and custom patterns', () => {
  it('exposes a CYCLE_LENGTH constant of 14', () => {
    expect(CYCLE_LENGTH).toBe(14);
    expect(resolveCycleLength()).toBe(14);
  });

  it('every preset has A and B with exactly 14 binary entries', () => {
    expect(ROTATION_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const p of ROTATION_PRESETS) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.teams.A).toHaveLength(14);
      expect(p.teams.B).toHaveLength(14);
      expect(p.teams.A.every(v => v === 0 || v === 1)).toBe(true);
      expect(p.teams.B.every(v => v === 0 || v === 1)).toBe(true);
    }
  });

  it('panama-223 preset matches the original Panama pattern', () => {
    const panama = ROTATION_PRESETS.find(p => p.id === 'panama-223');
    expect(panama.teams).toEqual(DEFAULT_PATTERN);
  });

  it('resolvePattern falls back to DEFAULT_PATTERN when config is null/undefined', () => {
    expect(resolvePattern(null)).toEqual(DEFAULT_PATTERN);
    expect(resolvePattern(undefined)).toEqual(DEFAULT_PATTERN);
    expect(resolvePattern({})).toEqual(DEFAULT_PATTERN);
  });

  it('resolvePattern returns configured teams when valid', () => {
    const teams = {
      A: [1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0],
      B: [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1],
    };
    expect(resolvePattern({ rotation_pattern: { teams } })).toEqual(teams);
  });

  it('resolvePattern silently falls back on malformed teams (never throws)', () => {
    const bad1 = { rotation_pattern: { teams: { A: [1, 1], B: [0, 0] } } };
    const bad2 = { rotation_pattern: { teams: { A: 'not an array', B: [] } } };
    const bad3 = { rotation_pattern: { teams: { A: [1, 2, 0], B: [0, 1, 0] } } };
    expect(resolvePattern(bad1)).toEqual(DEFAULT_PATTERN);
    expect(resolvePattern(bad2)).toEqual(DEFAULT_PATTERN);
    expect(resolvePattern(bad3)).toEqual(DEFAULT_PATTERN);
  });

  it('isValidTeamsShape rejects non-binary, wrong-length, and non-array inputs', () => {
    expect(isValidTeamsShape({ A: Array(14).fill(1), B: Array(14).fill(0) })).toBe(true);
    expect(isValidTeamsShape({ A: Array(13).fill(1), B: Array(14).fill(0) })).toBe(false);
    expect(isValidTeamsShape({ A: Array(14).fill(2), B: Array(14).fill(0) })).toBe(false);
    expect(isValidTeamsShape({ A: 'no', B: 'way' })).toBe(false);
    expect(isValidTeamsShape(null)).toBe(false);
  });

  it('getScheduledShift uses the configured pattern when present', () => {
    // Custom pattern: Day A working every day
    const teams = { A: Array(14).fill(1), B: Array(14).fill(0) };
    const config = { rotation_pattern: { teams } };
    const staff = { id: 'S1', team: 'Day A', pref: 'E', active: true };
    for (let i = 0; i < 14; i++) {
      expect(getScheduledShift(staff, i, '2025-01-06', config)).toBe('E');
    }
  });

  it('getScheduledShift falls back to Panama 2-2-3 when config omitted (backwards compat)', () => {
    const staff = { id: 'S1', team: 'Day A', pref: 'E', active: true };
    // Panama pattern has Day A working on cycle day 0 and off on day 2
    expect(getScheduledShift(staff, 0, '2025-01-06')).toBe('E');
    expect(getScheduledShift(staff, 2, '2025-01-06')).toBe('OFF');
  });

  it('getActualShift threads config to getScheduledShift for custom patterns', () => {
    const teams = { A: Array(14).fill(0), B: Array(14).fill(1) };  // Day A never works
    const config = { rotation_pattern: { teams }, cycle_start_date: '2025-01-06' };
    const staff = { id: 'S1', team: 'Day A', pref: 'E', active: true };
    const result = getActualShift(staff, '2025-01-06', {}, '2025-01-06', config);
    expect(result.shift).toBe('OFF');  // would be E under Panama, OFF under custom
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

  it('supports NS as an override shift', () => {
    const overrides = { '2025-01-06': { S1: { shift: 'NS', reason: 'No show' } } };
    const result = getActualShift(staff, dateOn, overrides, START);
    expect(result.shift).toBe('NS');
    expect(result.reason).toBe('No show');
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
  // Good Friday 2025 (2025-04-18) is at cycle day 102 % 14 = 4, which is a
  // working day for both Day A and Night A (pattern index 4 = 1). Using this
  // instead of Christmas (cycle day 3 = index 3 = 0 = OFF for both teams),
  // which would make the bank-holiday upgrade assertions vacuously pass.
  const BH_DATE = '2025-04-18';
  const config = {
    cycle_start_date: '2025-01-06',
    bank_holidays: [{ date: BH_DATE, name: 'Good Friday' }],
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
    minimum_staffing: { early: { heads: 2, skill_points: 2 }, late: { heads: 2, skill_points: 2 }, night: { heads: 1, skill_points: 1 } },
    agency_rate_day: 22, agency_rate_night: 25,
  };

  const staffDayA = { id: 'S1', name: 'Alice', team: 'Day A', pref: 'E', role: 'Carer', skill: 1, hourly_rate: 13, active: true };
  const staffNightA = { id: 'S2', name: 'Bob', team: 'Night A', role: 'Night Carer', skill: 1, hourly_rate: 13.5, active: true };

  it('upgrades day shifts to BH-D on bank holiday', () => {
    // BH_DATE is cycle day 4 = working day for Day A — assertion is unconditional
    const result = getStaffForDay([staffDayA], BH_DATE, {}, config);
    const alice = result.find(s => s.id === 'S1');
    expect(alice.shift).toBe('BH-D');
  });

  it('upgrades night shifts to BH-N on bank holiday', () => {
    // BH_DATE is cycle day 4 = working day for Night A — assertion is unconditional
    const result = getStaffForDay([staffNightA], BH_DATE, {}, config);
    const bob = result.find(s => s.id === 'S2');
    expect(bob.shift).toBe('BH-N');
  });

  it('does not upgrade shifts on a normal day', () => {
    const result = getStaffForDay([staffDayA], '2025-04-17', {}, config); // day before Good Friday — not a BH
    const alice = result.find(s => s.id === 'S1');
    expect(['E', 'OFF']).toContain(alice.shift); // E or OFF depending on cycle day — never BH-D
    expect(alice.shift).not.toBe('BH-D');
  });

  it('does not upgrade agency shifts on bank holiday', () => {
    const overrides = { [BH_DATE]: { S3: { shift: 'AG-E' } } };
    const agencyStaff = [{ id: 'S3', name: 'Agency', team: 'Agency', role: 'Carer', skill: 0.5, hourly_rate: 22, active: true }];
    const result = getStaffForDay(agencyStaff, BH_DATE, overrides, config);
    const ag = result.find(s => s.id === 'S3');
    expect(ag?.shift).toBe('AG-E'); // no upgrade for agency
  });
});

// ── getShiftHours — ADM/TRN configurable hours ────────────────────────────────

describe('getShiftHours — ADM/TRN configurable hours', () => {
  const baseConfig = {
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
  };

  it('returns EL hours when ADM/TRN not in config (fallback)', () => {
    expect(getShiftHours('ADM', baseConfig)).toBe(12);
    expect(getShiftHours('TRN', baseConfig)).toBe(12);
  });

  it('returns configured ADM hours when set', () => {
    const config = { shifts: { ...baseConfig.shifts, ADM: { hours: 8 } } };
    expect(getShiftHours('ADM', config)).toBe(8);
  });

  it('returns configured TRN hours when set', () => {
    const config = { shifts: { ...baseConfig.shifts, TRN: { hours: 4 } } };
    expect(getShiftHours('TRN', config)).toBe(4);
  });

  it('ADM config does not affect TRN and vice versa', () => {
    const config = { shifts: { ...baseConfig.shifts, ADM: { hours: 6 }, TRN: { hours: 3 } } };
    expect(getShiftHours('ADM', config)).toBe(6);
    expect(getShiftHours('TRN', config)).toBe(3);
  });

  it('regular shifts still work correctly', () => {
    expect(getShiftHours('E', baseConfig)).toBe(8);
    expect(getShiftHours('N', baseConfig)).toBe(10);
    expect(getShiftHours('EL', baseConfig)).toBe(12);
  });
});

// ── calculateStaffPeriodHours — agency shifts skipped ─────────────────────────

describe('calculateStaffPeriodHours — agency shift exclusion', () => {
  const config = {
    cycle_start_date: '2025-01-06',
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
    ot_premium: 5,
    bh_premium_multiplier: 2,
  };

  const staff = { id: 'S1', team: 'Day A', pref: 'E', skill: 1, hourly_rate: 13, active: true, wtr_opt_out: false };

  it('does not count AG-E in staff totalHours', () => {
    // Override all 7 days to AG-E — should NOT count as this staff member's hours
    const dates = [];
    const overrides = {};
    for (let i = 0; i < 7; i++) {
      const d = addDays('2025-01-06', i);
      dates.push(d);
      const key = formatDate(d);
      overrides[key] = { S1: { shift: 'AG-E' } };
    }
    const result = calculateStaffPeriodHours(staff, dates, overrides, config);
    expect(result.totalHours).toBe(0);
  });

  it('counts regular working shifts in totalHours', () => {
    // Override first day to E (working), rest to OFF
    const dates = [];
    const overrides = {};
    for (let i = 0; i < 7; i++) {
      const d = addDays('2025-01-06', i);
      dates.push(d);
      const key = formatDate(d);
      overrides[key] = { S1: { shift: i === 0 ? 'E' : 'OFF' } };
    }
    const result = calculateStaffPeriodHours(staff, dates, overrides, config);
    expect(result.totalHours).toBe(8); // One E shift = 8h
  });

  it('counts OT shifts in both totalHours and otHours', () => {
    const dates = [];
    const overrides = {};
    for (let i = 0; i < 7; i++) {
      const d = addDays('2025-01-06', i);
      dates.push(d);
      const key = formatDate(d);
      overrides[key] = { S1: { shift: i === 0 ? 'OC-E' : 'OFF' } };
    }
    const result = calculateStaffPeriodHours(staff, dates, overrides, config);
    expect(result.totalHours).toBe(8);
    expect(result.otHours).toBe(8);
  });

  it('excludes all agency shift variants (AG-E, AG-L, AG-N)', () => {
    const dates = [];
    const overrides = {};
    const agencyShifts = ['AG-E', 'AG-L', 'AG-N'];
    for (let i = 0; i < 3; i++) {
      const d = addDays('2025-01-06', i);
      dates.push(d);
      overrides[formatDate(d)] = { S1: { shift: agencyShifts[i] } };
    }
    const result = calculateStaffPeriodHours(staff, dates, overrides, config);
    expect(result.totalHours).toBe(0);
  });

  it('tracks AL days, hours, and pay separately from totalHours', () => {
    const dates = [];
    const overrides = {};
    for (let i = 0; i < 7; i++) {
      const d = addDays('2025-01-06', i);
      dates.push(d);
      overrides[formatDate(d)] = { S1: { shift: i < 2 ? 'AL' : 'OFF' } };
    }
    const result = calculateStaffPeriodHours(staff, dates, overrides, config);
    expect(result.alDays).toBe(2);
    expect(result.alHours).toBe(16); // 2 × 8h (E shift derived from scheduled)
    expect(result.alPay).toBe(16 * 13); // 16h × £13/hr
    // AL should NOT be in totalHours (would break WTR)
    expect(result.totalHours).toBe(0);
    // AL pay should be in totalPay
    expect(result.totalPay).toBe(result.alPay);
    // paidHours = worked + AL — for user-facing "hours this period" displays
    expect(result.paidHours).toBe(16);
  });

  it('paidHours sums worked hours and AL hours — booking AL does not reduce paid hours', () => {
    // Staff scheduled 3 working days (E = 8h each). Book AL on one of them.
    // Worked hours drop to 16 (2 × 8), but paidHours stays at 24 (16 worked + 8 AL).
    const dates = [];
    const overrides = {};
    for (let i = 0; i < 7; i++) {
      const d = addDays('2025-01-06', i);
      dates.push(d);
      const key = formatDate(d);
      if (i < 3) overrides[key] = { S1: { shift: i === 0 ? 'AL' : 'E' } };
      else overrides[key] = { S1: { shift: 'OFF' } };
    }
    const result = calculateStaffPeriodHours(staff, dates, overrides, config);
    expect(result.totalHours).toBe(16);  // only worked
    expect(result.alHours).toBe(8);      // one AL day
    expect(result.paidHours).toBe(24);   // worked + AL — this is what displays should show
  });

  it('AL hours uses getALDeductionHours (pref E = 8h)', () => {
    const staffWithContract = { ...staff, contract_hours: 37.5 };
    const dates = [addDays('2025-01-06', 0)];
    const overrides = { [formatDate(dates[0])]: { S1: { shift: 'AL' } } };
    const result = calculateStaffPeriodHours(staffWithContract, dates, overrides, config);
    // Scheduled E (8h) × hourly_rate (13) = 104
    expect(result.alHours).toBe(8);
    expect(result.alPay).toBe(104);
  });

  it('AL uses stored al_hours when present', () => {
    const dates = [addDays('2025-01-06', 0)];
    const overrides = { [formatDate(dates[0])]: { S1: { shift: 'AL', al_hours: 12 } } };
    const result = calculateStaffPeriodHours(staff, dates, overrides, config);
    expect(result.alHours).toBe(12); // stored value, not derived
    expect(result.alPay).toBe(12 * 13);
  });

  it('totalPay includes AL pay alongside working pay', () => {
    const dates = [];
    const overrides = {};
    for (let i = 0; i < 7; i++) {
      const d = addDays('2025-01-06', i);
      dates.push(d);
      overrides[formatDate(d)] = { S1: { shift: i === 0 ? 'E' : i === 1 ? 'AL' : 'OFF' } };
    }
    const result = calculateStaffPeriodHours(staff, dates, overrides, config);
    expect(result.totalHours).toBe(8); // 1 E shift
    expect(result.alDays).toBe(1);
    expect(result.alHours).toBe(8); // derived from scheduled E
    expect(result.totalPay).toBe(result.grossPay + result.otPay + result.bhPay + result.alPay);
  });

  it('does not count NS as working hours or paid hours', () => {
    const dates = [addDays('2025-01-06', 0)];
    const overrides = { [formatDate(dates[0])]: { S1: { shift: 'NS' } } };
    const result = calculateStaffPeriodHours(staff, dates, overrides, config);
    expect(result.totalHours).toBe(0);
    expect(result.paidHours).toBe(0);
  });
});

describe('getStaffStatus', () => {
  it('returns NO_SHOW for NS shifts', () => {
    expect(getStaffStatus('NS')).toBe('NO_SHOW');
  });
});

// ── calculateStaffPeriodHours — TRN/ADM pay logic ────────────────────────────

describe('calculateStaffPeriodHours — TRN/ADM pay logic', () => {
  const config = {
    cycle_start_date: '2025-01-06',
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
    ot_premium: 5,
    bh_premium_multiplier: 2,
  };

  // Day A staff, pref E — working on 2025-01-06 (cycle day 0, A-team works)
  const staff = { id: 'S1', team: 'Day A', pref: 'E', skill: 1, hourly_rate: 13, active: true, wtr_opt_out: false };

  it('TRN on a working day pays full scheduled shift hours', () => {
    // 2025-01-06 is cycle day 0 → Day A works → scheduled E (8h)
    const dates = [addDays('2025-01-06', 0)];
    const overrides = { [formatDate(dates[0])]: { S1: { shift: 'TRN' } } };
    const result = calculateStaffPeriodHours(staff, dates, overrides, config);
    // Should pay E hours (8) × rate (13) = 104, not TRN default
    expect(result.totalHours).toBe(8);
    expect(result.grossPay).toBe(104);
  });

  it('TRN on OFF day with override_hours pays actual training hours', () => {
    // 2025-01-08 is cycle day 2 → Day A OFF
    const dates = [addDays('2025-01-06', 2)];
    const overrides = { [formatDate(dates[0])]: { S1: { shift: 'TRN', override_hours: 4 } } };
    const result = calculateStaffPeriodHours(staff, dates, overrides, config);
    // Should pay 4h × rate (13) = 52
    expect(result.totalHours).toBe(4);
    expect(result.grossPay).toBe(52);
  });

  it('TRN on OFF day without override_hours falls back to config TRN hours', () => {
    const dates = [addDays('2025-01-06', 2)];
    const overrides = { [formatDate(dates[0])]: { S1: { shift: 'TRN' } } };
    const result = calculateStaffPeriodHours(staff, dates, overrides, config);
    // No override_hours, no config.shifts.TRN → falls back to EL hours (12) × rate (13)
    expect(result.totalHours).toBe(12);
    expect(result.grossPay).toBe(156);
  });

  it('ADM on a working day pays full scheduled shift hours (same as TRN)', () => {
    const dates = [addDays('2025-01-06', 0)];
    const overrides = { [formatDate(dates[0])]: { S1: { shift: 'ADM' } } };
    const result = calculateStaffPeriodHours(staff, dates, overrides, config);
    expect(result.totalHours).toBe(8);
    expect(result.grossPay).toBe(104);
  });

  it('ADM on OFF day with override_hours pays actual admin hours', () => {
    const dates = [addDays('2025-01-06', 2)];
    const overrides = { [formatDate(dates[0])]: { S1: { shift: 'ADM', override_hours: 3 } } };
    const result = calculateStaffPeriodHours(staff, dates, overrides, config);
    expect(result.totalHours).toBe(3);
    expect(result.grossPay).toBe(39);
  });

  it('Night staff TRN on working day pays N hours', () => {
    const nightStaff = { ...staff, team: 'Night A', pref: 'N' };
    const dates = [addDays('2025-01-06', 0)];
    const overrides = { [formatDate(dates[0])]: { S1: { shift: 'TRN' } } };
    const result = calculateStaffPeriodHours(nightStaff, dates, overrides, config);
    // Night A works on day 0, scheduled N (10h) × rate (13) = 130
    expect(result.totalHours).toBe(10);
    expect(result.grossPay).toBe(130);
  });
});

// ── getShiftHours — crash-safe with incomplete config ────────────────────────

describe('getShiftHours — crash-safe with incomplete config', () => {
  it('returns 0 when config is null', () => {
    expect(getShiftHours('E', null)).toBe(0);
  });

  it('returns 0 when config.shifts is undefined', () => {
    expect(getShiftHours('E', {})).toBe(0);
  });

  it('returns 0 when specific shift is missing from config', () => {
    expect(getShiftHours('E', { shifts: {} })).toBe(0);
  });

  it('returns 0 for OC-E when E is missing from config', () => {
    expect(getShiftHours('OC-E', { shifts: { L: { hours: 8 } } })).toBe(0);
  });

  it('ADM falls back to EL hours when ADM not defined', () => {
    expect(getShiftHours('ADM', { shifts: { EL: { hours: 12 } } })).toBe(12);
  });

  it('ADM returns 0 when neither ADM nor EL defined', () => {
    expect(getShiftHours('ADM', { shifts: {} })).toBe(0);
  });
});

// ── getLeaveYear ────────────────────────────────────────────────────────────

describe('getLeaveYear (shared)', () => {
  it('returns correct boundaries for April start', () => {
    const ly = getLeaveYear('2025-06-15', '04-01');
    expect(ly.startStr).toBe('2025-04-01');
    expect(ly.endStr).toBe('2026-03-31');
  });

  it('wraps to previous year for dates before boundary', () => {
    const ly = getLeaveYear('2025-02-01', '04-01');
    expect(ly.startStr).toBe('2024-04-01');
    expect(ly.endStr).toBe('2025-03-31');
  });
});

// ── STATUTORY_WEEKS ─────────────────────────────────────────────────────────

describe('STATUTORY_WEEKS', () => {
  it('is 5.6', () => {
    expect(STATUTORY_WEEKS).toBe(5.6);
  });
});

// ── getALDeductionHours ─────────────────────────────────────────────────────

describe('getALDeductionHours', () => {
  const config = {
    cycle_start_date: '2025-01-06',
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
  };

  it('returns EL hours (12) for Day A staff with EL pref on a working day', () => {
    const staff = { id: 'S1', team: 'Day A', pref: 'EL', contract_hours: 36, start_date: '2024-01-01' };
    // 2025-01-06 is cycle day 0 — Day A works
    const hrs = getALDeductionHours(staff, '2025-01-06', config);
    expect(hrs).toBe(12);
  });

  it('returns N hours (10) for Night A staff on a working day', () => {
    const staff = { id: 'S2', team: 'Night A', contract_hours: 36, start_date: '2024-01-01' };
    const hrs = getALDeductionHours(staff, '2025-01-06', config);
    expect(hrs).toBe(10);
  });

  it('returns contract_hours/5 for Float staff (AVL)', () => {
    const staff = { id: 'S3', team: 'Float', contract_hours: 37.5, start_date: '2024-01-01' };
    const hrs = getALDeductionHours(staff, '2025-01-06', config);
    // 37.5 / 5 = 7.5
    expect(hrs).toBe(7.5);
  });

  it('returns 0 for a scheduled OFF day', () => {
    const staff = { id: 'S1', team: 'Day A', pref: 'EL', contract_hours: 36, start_date: '2024-01-01' };
    // 2025-01-08 is cycle day 2 — Day A OFF
    const hrs = getALDeductionHours(staff, '2025-01-08', config);
    expect(hrs).toBe(0);
  });

  it('returns 0 for Float staff with no contract_hours', () => {
    const staff = { id: 'S3', team: 'Float', contract_hours: 0, start_date: '2024-01-01' };
    const hrs = getALDeductionHours(staff, '2025-01-06', config);
    expect(hrs).toBe(0); // no contract hours = cannot calculate
  });

  it('returns 0 when config shifts are missing', () => {
    const staff = { id: 'S1', team: 'Day A', pref: 'EL', contract_hours: 36, start_date: '2024-01-01' };
    const hrs = getALDeductionHours(staff, '2025-01-06', { cycle_start_date: '2025-01-06', shifts: {} });
    expect(hrs).toBe(0); // missing config = cannot calculate
  });
});

// ── addDays DST correctness ─────────────────────────────────────────────────

describe('addDays DST boundaries', () => {
  it('BST spring-forward: 2025-03-30 + 1 = 2025-03-31', () => {
    const result = addDays(parseDate('2025-03-30'), 1);
    expect(formatDate(result)).toBe('2025-03-31');
  });

  it('BST autumn-back: 2025-10-26 + 1 = 2025-10-27', () => {
    const result = addDays(parseDate('2025-10-26'), 1);
    expect(formatDate(result)).toBe('2025-10-27');
  });

  it('non-leap year boundary: 2025-02-28 + 1 = 2025-03-01', () => {
    const result = addDays(parseDate('2025-02-28'), 1);
    expect(formatDate(result)).toBe('2025-03-01');
  });
});
