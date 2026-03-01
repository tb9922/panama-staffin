import { describe, it, expect } from 'vitest';
import {
  calculateCoverage,
  getEscalationLevel,
  calculateDayCost,
} from '../escalation.js';

// ── Shared fixtures ────────────────────────────────────────────────────────────

const config = {
  cycle_start_date: '2025-01-06',
  minimum_staffing: {
    early: { heads: 3, skill_points: 3 },
    late:  { heads: 3, skill_points: 3 },
    night: { heads: 2, skill_points: 2 },
  },
  shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
  ot_premium: 3,
  agency_rate_day: 22,
  agency_rate_night: 25,
  bh_premium_multiplier: 1.5,
};

function makeCarer(id, shift, skill = 1, team = 'Day A', role = 'Carer', rate = 13) {
  return { id, name: `Staff ${id}`, role, team, shift, skill, hourly_rate: rate, active: true };
}

// ── calculateCoverage ─────────────────────────────────────────────────────────

describe('calculateCoverage', () => {
  it('returns isCovered=true when heads and skill points both met', () => {
    const staff = [
      makeCarer('S1', 'E'),
      makeCarer('S2', 'E'),
      makeCarer('S3', 'E'),
    ];
    const cov = calculateCoverage(staff, 'early', config);
    expect(cov.headCount).toBe(3);
    expect(cov.skillPoints).toBe(3);
    expect(cov.headGap).toBe(0);
    expect(cov.skillGap).toBe(0);
    expect(cov.isCovered).toBe(true);
  });

  it('returns isCovered=false when one head short', () => {
    const staff = [makeCarer('S1', 'E'), makeCarer('S2', 'E')];
    const cov = calculateCoverage(staff, 'early', config);
    expect(cov.headCount).toBe(2);
    expect(cov.headGap).toBe(1);
    expect(cov.isCovered).toBe(false);
  });

  it('returns isCovered=false when skill gap exists (heads met)', () => {
    // 3 heads but only 0.5 skill each = 1.5 points; need 3
    const staff = [
      makeCarer('S1', 'E', 0.5),
      makeCarer('S2', 'E', 0.5),
      makeCarer('S3', 'E', 0.5),
    ];
    const cov = calculateCoverage(staff, 'early', config);
    expect(cov.headCount).toBe(3);
    expect(cov.headGap).toBe(0);
    expect(cov.skillGap).toBeGreaterThan(0);
    expect(cov.isCovered).toBe(false);
  });

  it('counts only care roles for early coverage', () => {
    // Admin role should not count toward coverage
    const staff = [
      makeCarer('S1', 'E', 1, 'Day A', 'Carer'),
      makeCarer('S2', 'E', 1, 'Day A', 'Carer'),
      { id: 'S3', name: 'Admin', role: 'Admin', team: 'Day A', shift: 'E', skill: 1, hourly_rate: 15, active: true },
    ];
    const cov = calculateCoverage(staff, 'early', config);
    expect(cov.headCount).toBe(2); // Admin excluded
    expect(cov.isCovered).toBe(false);
  });

  it('counts night shifts for night coverage', () => {
    const staff = [makeCarer('S1', 'N', 1, 'Night A', 'Night Carer'), makeCarer('S2', 'N', 1, 'Night A', 'Night Carer')];
    const nightCov = calculateCoverage(staff, 'night', config);
    expect(nightCov.headCount).toBe(2);
    expect(nightCov.isCovered).toBe(true);
  });

  it('does not count early staff toward night coverage', () => {
    const staff = [makeCarer('S1', 'E'), makeCarer('S2', 'E')];
    const nightCov = calculateCoverage(staff, 'night', config);
    expect(nightCov.headCount).toBe(0);
    expect(nightCov.isCovered).toBe(false);
  });
});

// ── getEscalationLevel ────────────────────────────────────────────────────────

describe('getEscalationLevel', () => {
  function coveredCoverage() {
    return { isCovered: true, headGap: 0, skillGap: 0, headCount: 3, skillPoints: 3 };
  }
  function uncoveredCoverage(headGap = 1, skillGap = 0) {
    return { isCovered: false, headGap, skillGap, headCount: 3 - headGap, skillPoints: 3 - skillGap };
  }

  it('returns LVL0 when covered, no agency/OT/float', () => {
    const staff = [makeCarer('S1', 'E'), makeCarer('S2', 'E'), makeCarer('S3', 'E')];
    const esc = getEscalationLevel(coveredCoverage(), staff);
    expect(esc.level).toBe(0);
    expect(esc.status).toContain('LVL0');
  });

  it('returns LVL1 when covered with float deployed', () => {
    const staff = [
      makeCarer('S1', 'E'),
      makeCarer('S2', 'E'),
      { ...makeCarer('SF', 'E', 1, 'Float'), team: 'Float' },
    ];
    const esc = getEscalationLevel(coveredCoverage(), staff);
    expect(esc.level).toBe(1);
  });

  it('returns LVL2 when covered with OT (no agency)', () => {
    const staff = [makeCarer('S1', 'E'), makeCarer('S2', 'E'), makeCarer('S3', 'OC-E')];
    const esc = getEscalationLevel(coveredCoverage(), staff);
    expect(esc.level).toBe(2);
  });

  it('returns LVL3 when covered with agency', () => {
    const staff = [makeCarer('S1', 'E'), makeCarer('S2', 'E'), makeCarer('S3', 'AG-E')];
    const esc = getEscalationLevel(coveredCoverage(), staff);
    expect(esc.level).toBe(3);
  });

  it('returns LVL4 Short when 1 head gap', () => {
    const staff = [makeCarer('S1', 'E'), makeCarer('S2', 'E')];
    const esc = getEscalationLevel(uncoveredCoverage(1, 0), staff);
    expect(esc.level).toBe(4);
    expect(esc.status).toContain('LVL4');
  });

  it('returns LVL4 Skill Gap when heads met but skill gap', () => {
    const staff = [makeCarer('S1', 'E'), makeCarer('S2', 'E'), makeCarer('S3', 'E')];
    const esc = getEscalationLevel(uncoveredCoverage(0, 1.5), staff);
    expect(esc.level).toBe(4);
    expect(esc.status).toContain('Skill Gap');
  });

  it('returns LVL5 UNSAFE when 2+ heads short', () => {
    const staff = [makeCarer('S1', 'E')];
    const esc = getEscalationLevel(uncoveredCoverage(2, 0), staff);
    expect(esc.level).toBe(5);
    expect(esc.status).toContain('UNSAFE');
  });
});

// ── calculateDayCost ──────────────────────────────────────────────────────────

describe('calculateDayCost', () => {
  it('calculates base cost for regular E shifts', () => {
    // 2 carers at £13/hr, 8h E shift each: base = 2 × 8 × 13 = £208
    const staff = [makeCarer('S1', 'E', 1, 'Day A', 'Carer', 13), makeCarer('S2', 'E', 1, 'Day A', 'Carer', 13)];
    const cost = calculateDayCost(staff, config);
    expect(cost.base).toBe(208);
    expect(cost.otPremium).toBe(0);
    expect(cost.agencyDay).toBe(0);
    expect(cost.bhPremium).toBe(0);
    expect(cost.total).toBe(208);
  });

  it('adds OT premium for OC-E shifts', () => {
    // 1 carer at £13/hr, 8h OC-E: base = 104, otPremium = 8 × £3 = £24
    const staff = [makeCarer('S1', 'OC-E', 1, 'Day A', 'Carer', 13)];
    const cost = calculateDayCost(staff, config);
    expect(cost.base).toBe(104);
    expect(cost.otPremium).toBe(24);
    expect(cost.total).toBe(128);
  });

  it('uses agency day rate (not staff rate) for AG-E shifts', () => {
    // Agency day rate = £22/hr, 8h E shift: agencyDay = 8 × 22 = £176, base should be 0
    const staff = [makeCarer('S1', 'AG-E', 1, 'Agency', 'Carer', 999)]; // rate should be ignored
    const cost = calculateDayCost(staff, config);
    expect(cost.agencyDay).toBe(176); // 8 × 22
    expect(cost.base).toBe(0); // staff rate NOT used
    expect(cost.total).toBe(176);
  });

  it('uses agency night rate for AG-N shifts', () => {
    // Agency night rate = £25/hr, 10h N shift: agencyNight = 10 × 25 = £250
    const staff = [makeCarer('S1', 'AG-N', 1, 'Agency', 'Night Carer', 999)];
    const cost = calculateDayCost(staff, config);
    expect(cost.agencyNight).toBe(250); // 10 × 25
    expect(cost.base).toBe(0);
    expect(cost.total).toBe(250);
  });

  it('calculates BH premium for BH-D shifts', () => {
    // BH-D = 12h (EL hours), rate £13/hr, multiplier 1.5
    // base = 12 × 13 = 156, bhPremium = 12 × 13 × (1.5 - 1) = 78
    const staff = [makeCarer('S1', 'BH-D', 1, 'Day A', 'Carer', 13)];
    const cost = calculateDayCost(staff, config);
    expect(cost.base).toBe(156);
    expect(cost.bhPremium).toBe(78);
    expect(cost.total).toBe(234);
  });

  it('ignores OFF and SICK shifts (zero cost)', () => {
    const staff = [
      makeCarer('S1', 'OFF'),
      makeCarer('S3', 'SICK'),
    ];
    const cost = calculateDayCost(staff, config);
    expect(cost.total).toBe(0);
  });

  it('handles mixed shift types correctly', () => {
    const staff = [
      makeCarer('S1', 'E', 1, 'Day A', 'Carer', 13),    // base: 104
      makeCarer('S2', 'OC-E', 1, 'Day A', 'Carer', 13), // base: 104 + ot: 24
      makeCarer('S3', 'AG-E', 1, 'Agency', 'Carer', 13), // agency: 176
    ];
    const cost = calculateDayCost(staff, config);
    expect(cost.base).toBe(208);
    expect(cost.otPremium).toBe(24);
    expect(cost.agencyDay).toBe(176);
    expect(cost.total).toBe(408);
  });

  it('AL cost uses staff pref shift hours (day staff, pref EL)', () => {
    const staff = [
      { ...makeCarer('S1', 'AL', 1, 'Day A', 'Carer', 13), pref: 'EL' },
    ];
    const cost = calculateDayCost(staff, config);
    // AL = EL hours (12) × 13 = 156
    expect(cost.base).toBe(156);
    expect(cost.total).toBe(156);
  });

  it('AL cost uses N hours for night staff', () => {
    const staff = [
      makeCarer('S1', 'AL', 1, 'Night A', 'Night Carer', 13),
    ];
    const cost = calculateDayCost(staff, config);
    // Night AL = N hours (10) × 13 = 130
    expect(cost.base).toBe(130);
  });

  it('AL cost adds to working staff base', () => {
    const staff = [
      makeCarer('S1', 'E', 1, 'Day A', 'Carer', 13),      // 8 × 13 = 104
      { ...makeCarer('S2', 'AL', 1, 'Day A', 'Carer', 13), pref: 'EL' }, // 12 × 13 = 156
    ];
    const cost = calculateDayCost(staff, config);
    expect(cost.base).toBe(260); // 104 + 156
  });

  it('TRN on working day pays full scheduled shift hours', () => {
    const staff = [
      { ...makeCarer('S1', 'TRN', 1, 'Day A', 'Carer', 13), scheduledShift: 'E' },
    ];
    const cost = calculateDayCost(staff, config);
    // Scheduled E (8h) × £13 = £104, NOT TRN default hours
    expect(cost.base).toBe(104);
  });

  it('TRN on OFF day with override_hours pays actual hours', () => {
    const staff = [
      { ...makeCarer('S1', 'TRN', 1, 'Day A', 'Carer', 13), scheduledShift: 'OFF', override_hours: 4 },
    ];
    const cost = calculateDayCost(staff, config);
    // 4h × £13 = £52
    expect(cost.base).toBe(52);
  });

  it('TRN on OFF day without override_hours falls back to config hours', () => {
    const staff = [
      { ...makeCarer('S1', 'TRN', 1, 'Day A', 'Carer', 13), scheduledShift: 'OFF' },
    ];
    const cost = calculateDayCost(staff, config);
    // No override_hours, no config.shifts.TRN → EL fallback (12h) × £13 = £156
    expect(cost.base).toBe(156);
  });

  it('ADM on working day pays full scheduled shift hours', () => {
    const staff = [
      { ...makeCarer('S1', 'ADM', 1, 'Day A', 'Carer', 13), scheduledShift: 'EL' },
    ];
    const cost = calculateDayCost(staff, config);
    // Scheduled EL (12h) × £13 = £156
    expect(cost.base).toBe(156);
  });

  it('ADM on OFF day with override_hours pays actual hours', () => {
    const staff = [
      { ...makeCarer('S1', 'ADM', 1, 'Day A', 'Carer', 13), scheduledShift: 'OFF', override_hours: 3 },
    ];
    const cost = calculateDayCost(staff, config);
    // 3h × £13 = £39
    expect(cost.base).toBe(39);
  });
});
