import { describe, it, expect } from 'vitest';
import { addDays, calculateStaffPeriodHours, formatDate, getStaffForDay } from '../rotation.js';
import { calculateCoverage, calculateDayCost, getDayCoverageStatus } from '../escalation.js';

const config = {
  cycle_start_date: '2025-01-06',
  shifts: {
    E: { hours: 8 },
    L: { hours: 8 },
    EL: { hours: 12 },
    N: { hours: 10 },
    ADM: { hours: 6 },
    TRN: { hours: 4 },
  },
  minimum_staffing: {
    early: { heads: 2, skill_points: 2 },
    late: { heads: 2, skill_points: 2 },
    night: { heads: 1, skill_points: 1 },
  },
  ot_premium: 5,
  bh_premium_multiplier: 1.5,
  agency_rate_day: 25,
  agency_rate_night: 30,
};

const alice = {
  id: 'S001',
  name: 'Alice Smith',
  team: 'Day A',
  pref: 'E',
  role: 'Senior Carer',
  skill: 2,
  hourly_rate: 14.5,
  contract_hours: 37.5,
  active: true,
  wtr_opt_out: false,
};

const bob = {
  id: 'S002',
  name: 'Bob Jones',
  team: 'Day B',
  pref: 'L',
  role: 'Carer',
  skill: 1,
  hourly_rate: 12.5,
  contract_hours: 37.5,
  active: true,
  wtr_opt_out: false,
};

function weekFrom(startDate, length = 7) {
  return Array.from({ length }, (_, index) => addDays(startDate, index));
}

describe('product invariants', () => {
  it('paidHours always equals worked hours plus AL hours', () => {
    const dates = weekFrom('2025-01-06');
    const overrides = {
      [formatDate(dates[0])]: { S001: { shift: 'AL', al_hours: 8 } },
      [formatDate(dates[1])]: { S001: { shift: 'OC-E' } },
      [formatDate(dates[2])]: { S001: { shift: 'ADM', override_hours: 4 } },
    };

    const stats = calculateStaffPeriodHours(alice, dates, overrides, config);

    expect(stats.paidHours).toBe(stats.totalHours + stats.alHours);
  });

  it('booking annual leave on a scheduled working day does not reduce paid hours', () => {
    const dates = weekFrom('2025-01-06');
    const before = calculateStaffPeriodHours(alice, dates, {}, config);
    const overrides = {
      [formatDate(dates[0])]: { S001: { shift: 'AL', al_hours: 8 } },
    };

    const after = calculateStaffPeriodHours(alice, dates, overrides, config);

    expect(after.paidHours).toBe(before.paidHours);
    expect(after.totalHours).toBeLessThan(before.totalHours);
  });

  it('WTR status never changes when only AL deduction hours change', () => {
    const dates = weekFrom('2025-01-06');
    const standardLeave = {
      [formatDate(dates[0])]: { S001: { shift: 'AL', al_hours: 8 } },
    };
    const boostedLeave = {
      [formatDate(dates[0])]: { S001: { shift: 'AL', al_hours: 16 } },
    };

    const standardStats = calculateStaffPeriodHours(alice, dates, standardLeave, config);
    const boostedStats = calculateStaffPeriodHours(alice, dates, boostedLeave, config);

    expect(boostedStats.wtrStatus).toBe(standardStats.wtrStatus);
    expect(boostedStats.totalHours).toBe(standardStats.totalHours);
    expect(boostedStats.paidHours).toBeGreaterThan(boostedStats.totalHours);
  });

  it('coverage gaps never go negative even when the rota is over-covered', () => {
    const staffForDay = [
      { ...alice, shift: 'E' },
      { ...bob, shift: 'L' },
      { ...bob, id: 'S003', name: 'Carol', team: 'Day A', shift: 'E', role: 'Carer', skill: 1.5 },
      { ...bob, id: 'S004', name: 'Dan', team: 'Day B', shift: 'L', role: 'Carer', skill: 1.5 },
    ];

    const earlyCoverage = calculateCoverage(staffForDay, 'early', config);
    const lateCoverage = calculateCoverage(staffForDay, 'late', config);

    expect(earlyCoverage.headGap).toBeGreaterThanOrEqual(0);
    expect(earlyCoverage.skillGap).toBeGreaterThanOrEqual(0);
    expect(lateCoverage.headGap).toBeGreaterThanOrEqual(0);
    expect(lateCoverage.skillGap).toBeGreaterThanOrEqual(0);
    expect(earlyCoverage.isCovered).toBe(true);
    expect(lateCoverage.isCovered).toBe(true);
  });

  it('non-working absences never count toward daily coverage', () => {
    const activeStaff = [
      { ...alice },
      { ...bob },
    ];
    const date = '2025-01-06';
    const overrides = {
      [date]: {
        S001: { shift: 'AL', al_hours: 8 },
        S002: { shift: 'NS' },
      },
    };

    const staffForDay = getStaffForDay(activeStaff, date, overrides, config);
    const coverage = getDayCoverageStatus(staffForDay, config);

    expect(coverage.early.coverage.headCount).toBe(0);
    expect(coverage.late.coverage.headCount).toBe(0);
    expect(coverage.early.coverage.skillPoints).toBe(0);
    expect(coverage.late.coverage.skillPoints).toBe(0);
  });

  it('day cost totals always equal the sum of all cost buckets', () => {
    const staffForDay = [
      { ...alice, shift: 'OC-E', scheduledShift: 'E', sleep_in: true },
      { ...bob, shift: 'AG-N', scheduledShift: 'OFF', sleep_in: false },
      { ...alice, id: 'S003', name: 'Carol', shift: 'AL', scheduledShift: 'E', al_hours: 8 },
    ];

    const cost = calculateDayCost(staffForDay, { ...config, sleep_in_rate: 60 });
    const recomposed = cost.base + cost.otPremium + cost.agencyDay + cost.agencyNight + cost.bhPremium + cost.sleepIn;

    expect(cost.total).toBe(recomposed);
    expect(cost.total).toBeGreaterThanOrEqual(0);
  });
});
