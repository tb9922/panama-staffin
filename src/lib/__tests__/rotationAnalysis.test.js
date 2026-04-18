import { describe, it, expect } from 'vitest';
import {
  scoreCycleStartOffset,
  checkWTRImpact,
  WTR_WEEKLY_LIMIT,
  WTR_WEEKLY_WARN,
  scoreGapFillCandidate,
  generateCoverPlan,
  generateHorizonRoster,
} from '../rotationAnalysis.js';
import { addDays, formatDate, parseDate } from '../rotation.js';

const config = {
  cycle_start_date: '2025-01-06',
  shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
  minimum_staffing: {
    early: { heads: 2, skill_points: 1 },
    late:  { heads: 2, skill_points: 1 },
    night: { heads: 1, skill_points: 1 },
  },
};

const staff = [
  { id: 'S1', name: 'A1', role: 'Carer',        team: 'Day A',   pref: 'E',  skill: 1, active: true },
  { id: 'S2', name: 'A2', role: 'Senior Carer', team: 'Day A',   pref: 'L',  skill: 1, active: true },
  { id: 'S3', name: 'A3', role: 'Carer',        team: 'Day A',   pref: 'EL', skill: 1, active: true },
  { id: 'S4', name: 'B1', role: 'Carer',        team: 'Day B',   pref: 'E',  skill: 1, active: true },
  { id: 'S5', name: 'B2', role: 'Senior Carer', team: 'Day B',   pref: 'L',  skill: 1, active: true },
  { id: 'S6', name: 'B3', role: 'Carer',        team: 'Day B',   pref: 'EL', skill: 1, active: true },
  { id: 'S7', name: 'NA', role: 'Night Carer',  team: 'Night A',             skill: 1, active: true },
  { id: 'S8', name: 'NB', role: 'Night Carer',  team: 'Night B',             skill: 1, active: true },
];

describe('scoreCycleStartOffset', () => {
  it('returns a stable shape: { covered, total, ratio }', () => {
    const result = scoreCycleStartOffset(config, staff, 0, new Date('2026-04-20T00:00:00Z'));
    expect(result).toMatchObject({
      covered: expect.any(Number),
      total: expect.any(Number),
      ratio: expect.any(Number),
    });
    expect(result.total).toBeGreaterThan(0);
    expect(result.ratio).toBeGreaterThanOrEqual(0);
    expect(result.ratio).toBeLessThanOrEqual(1);
  });

  it('total equals 28 days × 3 periods = 84 when all periods have minimums', () => {
    const result = scoreCycleStartOffset(config, staff, 0, new Date('2026-04-20T00:00:00Z'));
    expect(result.total).toBe(84);
  });

  it('scores are deterministic given the same inputs', () => {
    const fixedDate = new Date('2026-04-20T00:00:00Z');
    const a = scoreCycleStartOffset(config, staff, 3, fixedDate);
    const b = scoreCycleStartOffset(config, staff, 3, fixedDate);
    expect(a).toEqual(b);
  });

  it('treats offsets relative to the configured cycle_start_date, not today', () => {
    const fixedDate = new Date('2026-04-20T00:00:00Z');
    const shiftedStart = formatDate(addDays(parseDate(config.cycle_start_date), 3));
    const shiftedConfig = { ...config, cycle_start_date: shiftedStart };
    expect(scoreCycleStartOffset(config, staff, 3, fixedDate)).toEqual(
      scoreCycleStartOffset(shiftedConfig, staff, 0, fixedDate),
    );
  });

  it('all 14 offsets produce comparable numeric scores', () => {
    const fixedDate = new Date('2026-04-20T00:00:00Z');
    const results = [];
    for (let offset = 0; offset < 14; offset++) {
      results.push(scoreCycleStartOffset(config, staff, offset, fixedDate));
    }
    expect(results).toHaveLength(14);
    for (const r of results) {
      expect(r.total).toBe(84);
      expect(Number.isFinite(r.ratio)).toBe(true);
    }
  });

  it('skips periods with minimum heads of 0', () => {
    const configNoNights = {
      ...config,
      minimum_staffing: {
        early: { heads: 2, skill_points: 1 },
        late:  { heads: 2, skill_points: 1 },
        night: { heads: 0, skill_points: 0 },
      },
    };
    const result = scoreCycleStartOffset(configNoNights, staff, 0, new Date('2026-04-20T00:00:00Z'));
    expect(result.total).toBe(28 * 2); // only early + late
  });

  it('handles empty staff gracefully', () => {
    const result = scoreCycleStartOffset(config, [], 0, new Date('2026-04-20T00:00:00Z'));
    expect(result.total).toBe(84);
    expect(result.covered).toBe(0);
    expect(result.ratio).toBe(0);
  });
});

// ── checkWTRImpact ──────────────────────────────────────────────────────────

describe('checkWTRImpact', () => {
  // Monday 2026-04-20, so week = 2026-04-20..2026-04-26
  const configMixed = {
    cycle_start_date: '2026-04-20',
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
    ot_premium: 5,
    bh_premium_multiplier: 2,
  };

  // Staff on Day A, pref EL. Day A works cycle days 0,1,4,5,6,9,10 (Panama pattern).
  // With cycle_start_date=2026-04-20 (cycle day 0), across Mon-Sun:
  //   Mon(0)=1 Tue(1)=1 Wed(2)=0 Thu(3)=0 Fri(4)=1 Sat(5)=1 Sun(6)=1 → 5 working days × 12h = 60h baseline
  // For a more tractable test we use E (8h) pref instead: 5 × 8 = 40h baseline.
  const staffE = {
    id: 'S1', name: 'Alice', team: 'Day A', pref: 'E',
    skill: 1, hourly_rate: 13, active: true, wtr_opt_out: false,
  };
  const staffOptedOut = { ...staffE, wtr_opt_out: true };

  it('exposes 48h limit and 44h warn thresholds as constants', () => {
    expect(WTR_WEEKLY_LIMIT).toBe(48);
    expect(WTR_WEEKLY_WARN).toBe(44);
  });

  it('opted-out staff always allowed, even at extreme projections', () => {
    const r = checkWTRImpact(staffOptedOut, '2026-04-22', {}, configMixed, 'OC-EL');
    expect(r.ok).toBe(true);
    expect(r.warn).toBe(false);
    expect(r.message).toMatch(/opt-out/i);
  });

  it('non-working proposed shift (AL) always allowed — WTR is about work, not rest', () => {
    const r = checkWTRImpact(staffE, '2026-04-22', {}, configMixed, 'AL');
    expect(r.ok).toBe(true);
    expect(r.warn).toBe(false);
  });

  it('agency proposed shift skipped — hours belong to agency, not this staff', () => {
    const r = checkWTRImpact(staffE, '2026-04-22', {}, configMixed, 'AG-EL');
    expect(r.ok).toBe(true);
    expect(r.warn).toBe(false);
  });

  it('baseline E-pref Day A worker: no OT added → projected = 40h, ok, no warn', () => {
    // Adding OC-E on an already-working Monday just replaces E (8h) with OC-E (8h).
    // Total stays at 40h (5 working days × 8h).
    const r = checkWTRImpact(staffE, '2026-04-20', {}, configMixed, 'OC-E');
    expect(r.ok).toBe(true);
    expect(r.warn).toBe(false);
    expect(r.projectedHours).toBeCloseTo(40, 1);
  });

  it('adding OC-EL to an OFF day of a 40h worker pushes projected to 52h → block', () => {
    // Wed cycle day 2 is OFF for Day A. Adding OC-EL (12h) → 40 + 12 = 52h → breach.
    const r = checkWTRImpact(staffE, '2026-04-22', {}, configMixed, 'OC-EL');
    expect(r.ok).toBe(false);
    expect(r.warn).toBe(true);
    expect(r.projectedHours).toBeCloseTo(52, 1);
    expect(r.message).toMatch(/exceeds.*48h/i);
  });

  it('adding OC-E to an OFF day of a 40h worker pushes to 48h → allowed, warn', () => {
    // 40 + 8 = 48h → within limit, above 44 → warn
    const r = checkWTRImpact(staffE, '2026-04-22', {}, configMixed, 'OC-E');
    expect(r.ok).toBe(true);
    expect(r.warn).toBe(true);
    expect(r.projectedHours).toBeCloseTo(48, 1);
    expect(r.message).toMatch(/approaching.*48h/i);
  });

  it('existing overrides are respected — OT stacked on top of sick AL pre-existing', () => {
    const overrides = {
      '2026-04-21': { S1: { shift: 'AL' } }, // AL takes Tuesday off the worked column
    };
    // Baseline was 40h (5 working days × 8h). AL on Tue removes one working E (8h).
    // Now 32h base. Add OC-EL (12h) on Wed OFF day → 32 + 12 = 44h. At the warn threshold edge.
    const r = checkWTRImpact(staffE, '2026-04-22', overrides, configMixed, 'OC-EL');
    expect(r.ok).toBe(true);
    expect(r.projectedHours).toBeCloseTo(44, 1);
  });

  it('returns shape { ok, warn, projectedHours, message } consistently', () => {
    const r = checkWTRImpact(staffE, '2026-04-22', {}, configMixed, 'OC-EL');
    expect(r).toHaveProperty('ok');
    expect(r).toHaveProperty('warn');
    expect(r).toHaveProperty('projectedHours');
    expect(r).toHaveProperty('message');
  });

  it('null staff does not throw', () => {
    const r = checkWTRImpact(null, '2026-04-22', {}, configMixed, 'OC-EL');
    expect(r.ok).toBe(true);
  });
});

// ── scoreGapFillCandidate ──────────────────────────────────────────────────

describe('scoreGapFillCandidate', () => {
  const config = {
    cycle_start_date: '2025-01-06',
    agency_rate_day: 25,
    agency_rate_night: 30,
    max_consecutive_days: 6,
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
  };
  const baseStaff = {
    id: 'S1', name: 'Alice', team: 'Float', pref: 'EL',
    skill: 1, hourly_rate: 13, active: true, role: 'Carer', wtr_opt_out: false,
  };

  it('returns shape { score, breakdown: { cost, fatigue, skill, training } }', () => {
    const r = scoreGapFillCandidate(baseStaff, '2026-04-20', {}, config);
    expect(r).toHaveProperty('score');
    expect(r.breakdown).toHaveProperty('cost');
    expect(r.breakdown).toHaveProperty('fatigue');
    expect(r.breakdown).toHaveProperty('skill');
    expect(r.breakdown).toHaveProperty('training');
  });

  it('cost sub-score: cheaper staff score higher than more expensive staff', () => {
    const cheap = { ...baseStaff, hourly_rate: 10 };
    const expensive = { ...baseStaff, hourly_rate: 20 };
    const cheapScore = scoreGapFillCandidate(cheap, '2026-04-20', {}, config).breakdown.cost;
    const expensiveScore = scoreGapFillCandidate(expensive, '2026-04-20', {}, config).breakdown.cost;
    expect(cheapScore).toBeGreaterThan(expensiveScore);
  });

  it('cost sub-score: rate at or above agency rate → 0', () => {
    const atAgency = { ...baseStaff, hourly_rate: 25 };
    const overAgency = { ...baseStaff, hourly_rate: 35 };
    expect(scoreGapFillCandidate(atAgency, '2026-04-20', {}, config).breakdown.cost).toBe(0);
    expect(scoreGapFillCandidate(overAgency, '2026-04-20', {}, config).breakdown.cost).toBe(0);
  });

  it('cost sub-score: unknown rate (0 or null) → neutral 50', () => {
    const noRate = { ...baseStaff, hourly_rate: 0 };
    expect(scoreGapFillCandidate(noRate, '2026-04-20', {}, config).breakdown.cost).toBe(50);
  });

  it('skill sub-score: 0→0, 1→50, 2→100', () => {
    expect(scoreGapFillCandidate({ ...baseStaff, skill: 0 }, '2026-04-20', {}, config).breakdown.skill).toBe(0);
    expect(scoreGapFillCandidate({ ...baseStaff, skill: 1 }, '2026-04-20', {}, config).breakdown.skill).toBe(50);
    expect(scoreGapFillCandidate({ ...baseStaff, skill: 2 }, '2026-04-20', {}, config).breakdown.skill).toBe(100);
  });

  it('fatigue sub-score: exceeded → 0, atRisk → 50, ok → 100', () => {
    // Build overrides that create 8 consecutive working days (exceeds max_consecutive_days=6)
    const overrides = {};
    for (let i = 0; i < 8; i++) {
      const d = addDays('2026-04-13', i);
      overrides[formatDate(d)] = { S1: { shift: 'EL' } };
    }
    const r = scoreGapFillCandidate(baseStaff, '2026-04-20', overrides, config);
    expect(r.breakdown.fatigue).toBe(0);
  });

  it('training sub-score: no training data → neutral 100 (lenient)', () => {
    const r = scoreGapFillCandidate(baseStaff, '2026-04-20', {}, config);
    expect(r.breakdown.training).toBe(100);
  });

  it('sorting: identical fatigue/skill/training, different rates — cheaper wins', () => {
    const cheap = { ...baseStaff, hourly_rate: 10 };
    const expensive = { ...baseStaff, hourly_rate: 22 };
    const cheapScore = scoreGapFillCandidate(cheap, '2026-04-20', {}, config).score;
    const expensiveScore = scoreGapFillCandidate(expensive, '2026-04-20', {}, config).score;
    expect(cheapScore).toBeGreaterThan(expensiveScore);
  });

  it('composite weights sum to 1 (40+30+20+10)', () => {
    // All sub-scores 100 → composite 100.
    const maxStaff = { ...baseStaff, hourly_rate: 0.0001, skill: 2 };
    const r = scoreGapFillCandidate(maxStaff, '2026-04-20', {}, config);
    // Cost ≈ 100, fatigue 100, skill 100, training 100 → composite 100
    expect(r.score).toBe(100);
  });

  it('never throws on missing staff/config', () => {
    expect(() => scoreGapFillCandidate({}, '2026-04-20', {}, {})).not.toThrow();
    expect(() => scoreGapFillCandidate(baseStaff, '2026-04-20', null, null)).not.toThrow();
  });
});

// ── generateCoverPlan ──────────────────────────────────────────────────────

describe('generateCoverPlan', () => {
  const planConfig = {
    cycle_start_date: '2026-04-20', // Monday
    agency_rate_day: 25,
    agency_rate_night: 30,
    ot_premium: 5,
    max_consecutive_days: 6,
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
    minimum_staffing: {
      early: { heads: 2, skill_points: 1 },
      late:  { heads: 2, skill_points: 1 },
      night: { heads: 1, skill_points: 1 },
    },
  };

  // Day A care staff (work Mon=cycle day 0)
  const alice     = { id: 'S1', name: 'Alice',   role: 'Carer',        team: 'Day A', pref: 'E',  skill: 1, hourly_rate: 13, active: true };
  const bob       = { id: 'S2', name: 'Bob',     role: 'Senior Carer', team: 'Day A', pref: 'L',  skill: 1, hourly_rate: 14, active: true };
  const carol     = { id: 'S3', name: 'Carol',   role: 'Carer',        team: 'Day A', pref: 'EL', skill: 1, hourly_rate: 13, active: true };
  // Day B (OFF on Mon cycle day 0)
  const dave      = { id: 'S4', name: 'Dave',    role: 'Carer',        team: 'Day B', pref: 'E',  skill: 1, hourly_rate: 13, active: true };
  const eve       = { id: 'S5', name: 'Eve',     role: 'Carer',        team: 'Day B', pref: 'EL', skill: 1, hourly_rate: 13, active: true };
  // Float
  const finn      = { id: 'S6', name: 'Finn',    role: 'Float Carer',  team: 'Float', pref: 'EL', skill: 1, hourly_rate: 12, active: true };
  // Night A (work Mon)
  const helen     = { id: 'S8', name: 'Helen',   role: 'Night Carer',  team: 'Night A',            skill: 1, hourly_rate: 14, active: true };

  it('empty dates → empty plan', () => {
    const r = generateCoverPlan({ dates: [], overrides: {}, config: planConfig, staff: [alice, finn] });
    expect(r.assignments).toEqual([]);
    expect(r.totalCost).toBe(0);
  });

  it('fully covered day → no assignments', () => {
    // Alice (E), Bob (L), Helen (N) cover minimums for Mon. Carol extra. Dave/Eve OFF (Day B).
    const r = generateCoverPlan({
      dates: ['2026-04-20'],
      overrides: {},
      config: planConfig,
      staff: [alice, bob, carol, helen],
    });
    expect(r.assignments).toEqual([]);
  });

  it('one AL absence filled by float first', () => {
    // Remove Alice via AL. Now early = just Carol (via EL). Minimum early = 2. Shortfall 1.
    // Finn is a Float AVL on Mon → assigned to E cover.
    const overrides = {
      '2026-04-20': { S1: { shift: 'AL', al_hours: 8 } },
    };
    const r = generateCoverPlan({
      dates: ['2026-04-20'],
      overrides,
      config: planConfig,
      staff: [alice, bob, carol, finn, helen],
    });
    const floatAssigns = r.assignments.filter(a => a.kind === 'float');
    expect(floatAssigns.length).toBeGreaterThanOrEqual(1);
    expect(floatAssigns[0].staffId).toBe('S6');
    expect(floatAssigns[0].source).toBe('float');
  });

  it('no float available → OT from off-duty care staff (Day B)', () => {
    // Alice + Bob both AL on Mon. Early = just Carol (EL). Late = just Carol. Need 1 each extra.
    // No float staff. Dave/Eve are Day B → OFF on Mon cycle day 0 → eligible for OT.
    const overrides = {
      '2026-04-20': {
        S1: { shift: 'AL', al_hours: 8 },
        S2: { shift: 'AL', al_hours: 8 },
      },
    };
    const r = generateCoverPlan({
      dates: ['2026-04-20'],
      overrides,
      config: planConfig,
      staff: [alice, bob, carol, dave, eve, helen],
    });
    const otAssigns = r.assignments.filter(a => a.kind === 'ot');
    expect(otAssigns.length).toBeGreaterThanOrEqual(1);
    expect(otAssigns[0].source).toBe('ot');
    expect(otAssigns[0].shift).toMatch(/^OC-/);
  });

  it('no float and no off-duty care → agency', () => {
    // Alice AL, Bob AL. No float, no Day B staff.
    const overrides = {
      '2026-04-20': {
        S1: { shift: 'AL', al_hours: 8 },
        S2: { shift: 'AL', al_hours: 8 },
      },
    };
    const r = generateCoverPlan({
      dates: ['2026-04-20'],
      overrides,
      config: planConfig,
      staff: [alice, bob, carol, helen],
    });
    const agencyAssigns = r.assignments.filter(a => a.kind === 'agency');
    expect(agencyAssigns.length).toBeGreaterThanOrEqual(1);
    expect(agencyAssigns[0].staffId).toMatch(/^AG-/);
    expect(agencyAssigns[0].shift).toMatch(/^AG-/);
  });

  it('totalCost equals sum of per-assignment costs', () => {
    const overrides = {
      '2026-04-20': { S1: { shift: 'AL', al_hours: 8 } },
    };
    const r = generateCoverPlan({
      dates: ['2026-04-20'],
      overrides,
      config: planConfig,
      staff: [alice, bob, carol, finn, helen],
    });
    const summed = r.assignments.reduce((t, a) => t + a.cost, 0);
    expect(r.totalCost).toBeCloseTo(summed, 2);
  });

  it('agency staffId matches /^AG-[A-Z0-9]+$/ (compatible with existing endpoint)', () => {
    const overrides = {
      '2026-04-20': {
        S1: { shift: 'AL' },
        S2: { shift: 'AL' },
      },
    };
    const r = generateCoverPlan({
      dates: ['2026-04-20'],
      overrides,
      config: planConfig,
      staff: [alice, bob, carol, helen],
    });
    for (const a of r.assignments.filter(x => x.kind === 'agency')) {
      expect(a.staffId).toMatch(/^AG-[A-Z0-9]+$/);
    }
  });

  it('returns residualGaps=0 when agency config is present', () => {
    const overrides = {
      '2026-04-20': { S1: { shift: 'AL' } },
    };
    const r = generateCoverPlan({
      dates: ['2026-04-20'],
      overrides,
      config: planConfig,
      staff: [alice, bob, carol, helen],
    });
    expect(r.residualGaps).toBe(0);
  });
});

// ── generateHorizonRoster ─────────────────────────────────────────────────

describe('generateHorizonRoster', () => {
  const planConfig = {
    cycle_start_date: '2026-04-20', // Monday
    agency_rate_day: 25,
    agency_rate_night: 30,
    ot_premium: 5,
    max_consecutive_days: 6,
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
    minimum_staffing: {
      early: { heads: 2, skill_points: 1 },
      late:  { heads: 2, skill_points: 1 },
      night: { heads: 1, skill_points: 1 },
    },
  };
  const alice     = { id: 'S1', name: 'Alice',   role: 'Carer',        team: 'Day A', pref: 'E',  skill: 1, hourly_rate: 13, active: true };
  const bob       = { id: 'S2', name: 'Bob',     role: 'Senior Carer', team: 'Day A', pref: 'L',  skill: 1, hourly_rate: 14, active: true };
  const carol     = { id: 'S3', name: 'Carol',   role: 'Carer',        team: 'Day A', pref: 'EL', skill: 1, hourly_rate: 13, active: true };
  const dave      = { id: 'S4', name: 'Dave',    role: 'Carer',        team: 'Day B', pref: 'E',  skill: 1, hourly_rate: 13, active: true };
  const eve       = { id: 'S5', name: 'Eve',     role: 'Carer',        team: 'Day B', pref: 'EL', skill: 1, hourly_rate: 13, active: true };
  const helen     = { id: 'S8', name: 'Helen',   role: 'Night Carer',  team: 'Night A',            skill: 1, hourly_rate: 14, active: true };

  function datesRange(fromStr, days) {
    const out = [];
    for (let i = 0; i < days; i++) out.push(formatDate(addDays(fromStr, i)));
    return out;
  }

  it('empty dates → empty plan with zero summary', () => {
    const r = generateHorizonRoster({ dates: [], overrides: {}, config: planConfig, staff: [alice, bob, helen] });
    expect(r.assignments).toEqual([]);
    expect(r.summary.gapSlotsTotal).toBe(0);
    expect(r.summary.coverageFillPct).toBe(1); // vacuously full
  });

  it('fully-covered horizon → no assignments, 100% fill', () => {
    // Monday fully covered by Day A + Helen. Tuesday also Day A working (cycle day 1).
    const r = generateHorizonRoster({
      dates: ['2026-04-20', '2026-04-21'],
      overrides: {},
      config: planConfig,
      staff: [alice, bob, carol, helen],
    });
    expect(r.assignments).toEqual([]);
    expect(r.summary.coverageFillPct).toBe(1);
  });

  it('summary counts consistent with assignments by kind', () => {
    // Force gaps: everyone AL Mon + Tue. No floaters. Only agency fills.
    const overrides = {
      '2026-04-20': { S1: { shift: 'AL' }, S2: { shift: 'AL' }, S3: { shift: 'AL' } },
      '2026-04-21': { S1: { shift: 'AL' }, S2: { shift: 'AL' }, S3: { shift: 'AL' } },
    };
    const r = generateHorizonRoster({
      dates: ['2026-04-20', '2026-04-21'],
      overrides,
      config: planConfig,
      staff: [alice, bob, carol, helen],
    });
    expect(r.summary.floatShifts).toBe(0);
    expect(r.summary.otShifts).toBe(0);
    expect(r.summary.agencyShifts).toBe(r.assignments.length);
    expect(r.summary.agencyShifts).toBeGreaterThan(0);
  });

  it('anti-stacking: OT spreads across eligible off-duty staff rather than piling on one', () => {
    // Need multi-day early shortfall. Alice + Bob + Carol all AL on Mon, Tue, Wed.
    // Dave + Eve are Day B → OFF on those cycle days → both eligible for OT.
    // Helen covers nights.
    const overrides = {};
    for (const d of ['2026-04-20', '2026-04-21', '2026-04-22']) {
      overrides[d] = { S1: { shift: 'AL' }, S2: { shift: 'AL' }, S3: { shift: 'AL' } };
    }
    const r = generateHorizonRoster({
      dates: ['2026-04-20', '2026-04-21', '2026-04-22'],
      overrides,
      config: planConfig,
      staff: [alice, bob, carol, dave, eve, helen],
    });
    const otAssigns = r.assignments.filter(a => a.kind === 'ot');
    // If anti-stacking works, both Dave and Eve should appear in OT assignments.
    const uniqueOtStaff = new Set(otAssigns.map(a => a.staffId));
    expect(uniqueOtStaff.size).toBeGreaterThanOrEqual(2);
  });

  it('horizon WTR carry-forward: OT on Monday counted when deciding Tuesday OT', () => {
    // Only Dave available for OT. Give him OC-EL Monday (+12h) via pre-existing
    // override hint → that's not how the solver works, but we can test by making
    // Dave the only eligible OT candidate and forcing multiple days of shortfall
    // within the same calendar week. Eventually WTR should kick in and block
    // further OT rather than pushing him past 48h.
    const overrides = {};
    for (const d of ['2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24']) {
      overrides[d] = { S1: { shift: 'AL' }, S2: { shift: 'AL' } };
    }
    const r = generateHorizonRoster({
      dates: ['2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24'],
      overrides,
      config: planConfig,
      staff: [alice, bob, carol, dave, helen],
    });
    // Dave's OT should never push him past 48h this week. Count his OC- hours.
    const daveOt = r.assignments.filter(a => a.staffId === 'S4' && a.kind === 'ot');
    const daveOtHours = daveOt.reduce((t, a) => {
      if (a.shift === 'OC-E' || a.shift === 'OC-L') return t + 8;
      if (a.shift === 'OC-EL') return t + 12;
      if (a.shift === 'OC-N') return t + 10;
      return t;
    }, 0);
    expect(daveOtHours).toBeLessThanOrEqual(48);
  });

  it('coverageFillPct is 0..1', () => {
    const overrides = { '2026-04-20': { S1: { shift: 'AL' } } };
    const r = generateHorizonRoster({
      dates: datesRange('2026-04-20', 7),
      overrides,
      config: planConfig,
      staff: [alice, bob, carol, dave, eve, helen],
    });
    expect(r.summary.coverageFillPct).toBeGreaterThanOrEqual(0);
    expect(r.summary.coverageFillPct).toBeLessThanOrEqual(1);
  });

  it('totalCost equals sum of assignment costs', () => {
    const overrides = {
      '2026-04-20': { S1: { shift: 'AL' }, S2: { shift: 'AL' } },
      '2026-04-21': { S1: { shift: 'AL' }, S2: { shift: 'AL' } },
    };
    const r = generateHorizonRoster({
      dates: ['2026-04-20', '2026-04-21'],
      overrides,
      config: planConfig,
      staff: [alice, bob, carol, helen],
    });
    const summed = r.assignments.reduce((t, a) => t + a.cost, 0);
    expect(r.summary.totalCost).toBeCloseTo(summed, 2);
    expect(r.totalCost).toBeCloseTo(summed, 2);
  });

  it('summary shape stays stable', () => {
    const r = generateHorizonRoster({
      dates: ['2026-04-20'],
      overrides: {},
      config: planConfig,
      staff: [alice, bob, carol, helen],
    });
    expect(r.summary).toMatchObject({
      gapSlotsTotal: expect.any(Number),
      gapSlotsFilled: expect.any(Number),
      coverageFillPct: expect.any(Number),
      floatShifts: expect.any(Number),
      otShifts: expect.any(Number),
      agencyShifts: expect.any(Number),
      wtrWarnings: expect.any(Number),
      totalCost: expect.any(Number),
    });
  });
});
