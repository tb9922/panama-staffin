// CQC Compliance Scoring — Unit Tests
import { describe, it, expect } from 'vitest';
import {
  QUALITY_STATEMENTS,
  METRIC_DEFINITIONS,
  SCORE_BANDS,
  getScoreBand,
  getDateRange,
  ensureCqcDefaults,
  calculateTrainingCompliancePct,
  calculateTrainingBreakdown,
  calculateSafeguardingTrainingPct,
  calculateDbsCompliancePct,
  calculateFireDrillCompliancePct,
  calculateAppraisalCompletionPct,
  calculateMcaTrainingCompliancePct,
  calculateEqualityTrainingPct,
  calculateDataProtectionTrainingPct,
  calculateStaffTurnover,
  calculateTrainingTrend,
  calculateComplianceScore,
  getEvidenceForStatement,
  getDbsStatusList,
} from '../cqc.js';
import { DEFAULT_TRAINING_TYPES } from '../training.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeStaff(overrides = {}) {
  return {
    id: 'S001', name: 'Alice', role: 'Carer', team: 'Day A',
    pref: 'E', skill: 2, hourly_rate: 14, active: true,
    start_date: '2024-01-01', ...overrides,
  };
}

function baseConfig() {
  return {
    training_types: DEFAULT_TRAINING_TYPES.map(t => ({ ...t })),
    cycle_start_date: '2025-01-06',
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
    minimum_staffing: {
      early:  { heads: 3, skill_points: 5 },
      late:   { heads: 3, skill_points: 5 },
      night:  { heads: 2, skill_points: 3 },
    },
    agency_rate_day: 20, agency_rate_night: 22,
    ot_premium: 16, bh_premium_multiplier: 1.5,
    max_consecutive_days: 6,
    leave_year_start: '04-01',
    al_entitlement_days: 28,
    bank_holidays: [],
  };
}

// ── Constants ───────────────────────────────────────────────────────────────

describe('QUALITY_STATEMENTS', () => {
  it('has 34 quality statements', () => {
    expect(QUALITY_STATEMENTS).toHaveLength(34);
  });

  it('covers all 5 CQC categories', () => {
    const cats = new Set(QUALITY_STATEMENTS.map(q => q.category));
    expect(cats).toEqual(new Set(['safe', 'effective', 'caring', 'responsive', 'well-led']));
  });

  it('has unique IDs', () => {
    const ids = QUALITY_STATEMENTS.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has S1-S8 safe statements', () => {
    const safe = QUALITY_STATEMENTS.filter(q => q.category === 'safe');
    expect(safe.map(q => q.id).sort()).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
  });

  it('each has required fields', () => {
    for (const q of QUALITY_STATEMENTS) {
      expect(q).toHaveProperty('id');
      expect(q).toHaveProperty('category');
      expect(q).toHaveProperty('name');
      expect(q).toHaveProperty('cqcRef');
      expect(q).toHaveProperty('autoMetrics');
      expect(Array.isArray(q.autoMetrics)).toBe(true);
    }
  });
});

describe('METRIC_DEFINITIONS', () => {
  it('has 18 metrics', () => {
    expect(METRIC_DEFINITIONS).toHaveLength(18);
  });

  it('weights sum to 1.0', () => {
    const total = METRIC_DEFINITIONS.reduce((s, m) => s + m.weight, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(0.001);
  });

  it('all metrics are available', () => {
    expect(METRIC_DEFINITIONS.every(m => m.available)).toBe(true);
  });

  it('has unique IDs', () => {
    const ids = METRIC_DEFINITIONS.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('SCORE_BANDS', () => {
  it('has 4 bands: Outstanding, Good, Requires Improvement, Inadequate', () => {
    expect(SCORE_BANDS.map(b => b.label)).toEqual(['Outstanding', 'Good', 'Requires Improvement', 'Inadequate']);
  });

  it('bands are ordered by min descending', () => {
    for (let i = 0; i < SCORE_BANDS.length - 1; i++) {
      expect(SCORE_BANDS[i].min).toBeGreaterThan(SCORE_BANDS[i + 1].min);
    }
  });
});

// ── getScoreBand ────────────────────────────────────────────────────────────

describe('getScoreBand', () => {
  it('returns Outstanding for 90+', () => {
    expect(getScoreBand(90).label).toBe('Outstanding');
    expect(getScoreBand(100).label).toBe('Outstanding');
  });

  it('returns Good for 75-89', () => {
    expect(getScoreBand(75).label).toBe('Good');
    expect(getScoreBand(89).label).toBe('Good');
  });

  it('returns Requires Improvement for 50-74', () => {
    expect(getScoreBand(50).label).toBe('Requires Improvement');
    expect(getScoreBand(74).label).toBe('Requires Improvement');
  });

  it('returns Inadequate for <50', () => {
    expect(getScoreBand(49).label).toBe('Inadequate');
    expect(getScoreBand(0).label).toBe('Inadequate');
  });

  it('returns correct badge keys', () => {
    expect(getScoreBand(95).badgeKey).toBe('green');
    expect(getScoreBand(80).badgeKey).toBe('blue');
    expect(getScoreBand(60).badgeKey).toBe('amber');
    expect(getScoreBand(30).badgeKey).toBe('red');
  });
});

// ── getDateRange ────────────────────────────────────────────────────────────

describe('getDateRange', () => {
  it('defaults to 28 days', () => {
    const range = getDateRange();
    expect(range.days).toBe(28);
    expect(range.from).toBeInstanceOf(Date);
    expect(range.to).toBeInstanceOf(Date);
  });

  it('respects custom day count', () => {
    const range = getDateRange(7);
    expect(range.days).toBe(7);
    const diff = Math.round((range.to - range.from) / (1000 * 60 * 60 * 24));
    expect(diff).toBe(6); // 7 days inclusive = 6 day gap
  });
});

// ── ensureCqcDefaults ───────────────────────────────────────────────────────

describe('ensureCqcDefaults', () => {
  it('adds cqc_evidence when missing', () => {
    const data = { config: {} };
    const result = ensureCqcDefaults(data);
    expect(result).not.toBeNull();
    expect(result.cqc_evidence).toEqual([]);
  });

  it('returns null when cqc_evidence already exists', () => {
    const data = { config: {}, cqc_evidence: [{ id: 'e1' }] };
    expect(ensureCqcDefaults(data)).toBeNull();
  });

  it('preserves existing data', () => {
    const data = { config: { home_name: 'Test Home' }, staff: [{ id: 'S1' }] };
    const result = ensureCqcDefaults(data);
    expect(result.config.home_name).toBe('Test Home');
    expect(result.staff).toHaveLength(1);
  });
});

// ── calculateTrainingCompliancePct ──────────────────────────────────────────

describe('calculateTrainingCompliancePct', () => {
  const asOfDate = '2025-06-15';

  it('returns 100 for no staff', () => {
    const data = { staff: [], config: baseConfig(), training: {} };
    expect(calculateTrainingCompliancePct(data, asOfDate)).toBe(100);
  });

  it('returns 0 when no training records for staff', () => {
    const data = {
      staff: [makeStaff()],
      config: baseConfig(),
      training: {},
    };
    const pct = calculateTrainingCompliancePct(data, asOfDate);
    expect(pct).toBe(0);
  });

  it('counts compliant staff correctly', () => {
    // Create full training records for one staff member
    const staff = makeStaff();
    const config = baseConfig();
    const activeTypes = config.training_types.filter(t => t.active);

    // Make all required types compliant
    const records = {};
    for (const t of activeTypes) {
      records[t.id] = {
        completed: '2025-03-01',
        expiry: '2026-03-01',
        trainer: 'Test',
        method: 'classroom',
      };
    }

    const data = {
      staff: [staff],
      config,
      training: { S001: records },
    };

    const pct = calculateTrainingCompliancePct(data, asOfDate);
    expect(pct).toBeGreaterThan(90); // Should be ~100% or close
  });
});

// ── calculateTrainingBreakdown ──────────────────────────────────────────────

describe('calculateTrainingBreakdown', () => {
  const asOfDate = '2025-06-15';

  it('returns per-type breakdown', () => {
    const data = {
      staff: [makeStaff()],
      config: baseConfig(),
      training: {},
    };
    const result = calculateTrainingBreakdown(data, asOfDate);
    expect(result).toHaveProperty('stats');
    expect(result).toHaveProperty('perType');
    expect(result).toHaveProperty('nonCompliant');
    expect(result).toHaveProperty('matrix');
    expect(result.perType.length).toBeGreaterThan(0);
  });

  it('identifies non-compliant staff', () => {
    const staff = makeStaff();
    // Give one expired training
    const training = {
      S001: {
        'fire-safety': {
          completed: '2024-01-01',
          expiry: '2025-01-01', // Expired before asOfDate
          trainer: 'Test',
          method: 'classroom',
        },
      },
    };
    const data = { staff: [staff], config: baseConfig(), training };
    const result = calculateTrainingBreakdown(data, asOfDate);
    const fireEntry = result.nonCompliant.find(nc => nc.trainingName === 'Fire Safety');
    expect(fireEntry).toBeDefined();
    expect(fireEntry.staffName).toBe('Alice');
  });
});

// ── calculateSafeguardingTrainingPct ────────────────────────────────────────

describe('calculateSafeguardingTrainingPct', () => {
  const asOfDate = '2025-06-15';

  it('returns 100 for no staff', () => {
    const data = { staff: [], config: baseConfig(), training: {} };
    expect(calculateSafeguardingTrainingPct(data, asOfDate)).toBe(100);
  });

  it('returns 0 when safeguarding not completed', () => {
    const data = {
      staff: [makeStaff()],
      config: baseConfig(),
      training: {},
    };
    expect(calculateSafeguardingTrainingPct(data, asOfDate)).toBe(0);
  });

  it('returns 100 when all safeguarding types completed', () => {
    // Function checks both safeguarding-adults AND safeguarding-children
    const data = {
      staff: [makeStaff()],
      config: baseConfig(),
      training: {
        S001: {
          'safeguarding-adults': {
            completed: '2025-03-01', expiry: '2026-03-01',
            trainer: 'Test', method: 'classroom', level: 'L1',
          },
          'safeguarding-children': {
            completed: '2025-03-01', expiry: '2026-03-01',
            trainer: 'Test', method: 'classroom',
          },
        },
      },
    };
    expect(calculateSafeguardingTrainingPct(data, asOfDate)).toBe(100);
  });

  it('returns partial when only one safeguarding type completed', () => {
    const data = {
      staff: [makeStaff()],
      config: baseConfig(),
      training: {
        S001: {
          'safeguarding-adults': {
            completed: '2025-03-01', expiry: '2026-03-01',
            trainer: 'Test', method: 'classroom', level: 'L1',
          },
        },
      },
    };
    const pct = calculateSafeguardingTrainingPct(data, asOfDate);
    expect(pct).toBeLessThan(100);
    expect(pct).toBeGreaterThan(0);
  });
});

// ── calculateDbsCompliancePct ───────────────────────────────────────────────

describe('calculateDbsCompliancePct', () => {
  it('returns 100 for no care staff', () => {
    const data = { staff: [makeStaff({ role: 'Admin' })], onboarding: {} };
    expect(calculateDbsCompliancePct(data)).toBe(100);
  });

  it('returns 0 when DBS not completed', () => {
    const data = { staff: [makeStaff()], onboarding: {} };
    expect(calculateDbsCompliancePct(data)).toBe(0);
  });

  it('returns 100 when all DBS completed', () => {
    const data = {
      staff: [makeStaff()],
      onboarding: { S001: { dbs_check: { status: 'completed' } } },
    };
    expect(calculateDbsCompliancePct(data)).toBe(100);
  });

  it('returns 50 when 1 of 2 completed', () => {
    const data = {
      staff: [makeStaff(), makeStaff({ id: 'S002', name: 'Bob' })],
      onboarding: { S001: { dbs_check: { status: 'completed' } } },
    };
    expect(calculateDbsCompliancePct(data)).toBe(50);
  });

  it('excludes inactive staff', () => {
    const data = {
      staff: [makeStaff(), makeStaff({ id: 'S002', active: false })],
      onboarding: { S001: { dbs_check: { status: 'completed' } } },
    };
    expect(calculateDbsCompliancePct(data)).toBe(100);
  });
});

// ── calculateFireDrillCompliancePct ─────────────────────────────────────────

describe('calculateFireDrillCompliancePct', () => {
  const asOfDate = '2025-06-15';

  it('returns 0 for no drills', () => {
    const data = { fire_drills: [] };
    expect(calculateFireDrillCompliancePct(data, asOfDate)).toBe(0);
  });

  it('returns 100 for recent drill', () => {
    const data = {
      fire_drills: [{ id: 'fd1', date: '2025-06-01', time: '14:00', evacuation_time_seconds: 180 }],
    };
    expect(calculateFireDrillCompliancePct(data, asOfDate)).toBe(100);
  });

  it('returns 30 for very old drill', () => {
    const data = {
      fire_drills: [{ id: 'fd1', date: '2024-01-01', time: '14:00', evacuation_time_seconds: 180 }],
    };
    expect(calculateFireDrillCompliancePct(data, asOfDate)).toBe(30);
  });
});

// ── calculateAppraisalCompletionPct ─────────────────────────────────────────

describe('calculateAppraisalCompletionPct', () => {
  const asOfDate = '2025-06-15';

  it('returns 100 for no staff', () => {
    const data = { staff: [], config: baseConfig(), appraisals: {} };
    expect(calculateAppraisalCompletionPct(data, asOfDate)).toBe(100);
  });

  it('returns 0 when no appraisals recorded', () => {
    const data = {
      staff: [makeStaff()],
      config: baseConfig(),
      appraisals: {},
    };
    expect(calculateAppraisalCompletionPct(data, asOfDate)).toBe(0);
  });

  it('returns 100 when all staff appraised recently', () => {
    const data = {
      staff: [makeStaff()],
      config: baseConfig(),
      appraisals: {
        S001: [{ id: 'apr1', date: '2025-04-15', next_due: '2026-04-15' }],
      },
    };
    expect(calculateAppraisalCompletionPct(data, asOfDate)).toBe(100);
  });
});

// ── calculateMcaTrainingCompliancePct ───────────────────────────────────────

describe('calculateMcaTrainingCompliancePct', () => {
  const asOfDate = '2025-06-15';

  it('returns 100 for no staff', () => {
    const data = { staff: [], config: baseConfig(), training: {} };
    expect(calculateMcaTrainingCompliancePct(data, asOfDate)).toBe(100);
  });

  it('returns 100 when mca-dols type is not in config', () => {
    const config = baseConfig();
    config.training_types = config.training_types.filter(t => t.id !== 'mca-dols');
    const data = { staff: [makeStaff()], config, training: {} };
    expect(calculateMcaTrainingCompliancePct(data, asOfDate)).toBe(100);
  });
});

// ── calculateEqualityTrainingPct ────────────────────────────────────────────

describe('calculateEqualityTrainingPct', () => {
  const asOfDate = '2025-06-15';

  it('returns 100 for no staff', () => {
    const data = { staff: [], config: baseConfig(), training: {} };
    expect(calculateEqualityTrainingPct(data, asOfDate)).toBe(100);
  });

  it('returns 0 when not completed', () => {
    const data = { staff: [makeStaff()], config: baseConfig(), training: {} };
    expect(calculateEqualityTrainingPct(data, asOfDate)).toBe(0);
  });

  it('returns 100 when completed', () => {
    const data = {
      staff: [makeStaff()],
      config: baseConfig(),
      training: {
        S001: {
          'equality-diversity': {
            completed: '2025-03-01', expiry: '2026-03-01',
            trainer: 'Test', method: 'e-learning',
          },
        },
      },
    };
    expect(calculateEqualityTrainingPct(data, asOfDate)).toBe(100);
  });
});

// ── calculateDataProtectionTrainingPct ──────────────────────────────────────

describe('calculateDataProtectionTrainingPct', () => {
  const asOfDate = '2025-06-15';

  it('returns 100 for no staff', () => {
    const data = { staff: [], config: baseConfig(), training: {} };
    expect(calculateDataProtectionTrainingPct(data, asOfDate)).toBe(100);
  });

  it('returns 0 when not completed', () => {
    const data = { staff: [makeStaff()], config: baseConfig(), training: {} };
    expect(calculateDataProtectionTrainingPct(data, asOfDate)).toBe(0);
  });
});

// ── calculateStaffTurnover ──────────────────────────────────────────────────

describe('calculateStaffTurnover', () => {
  it('returns 0 with no leavers', () => {
    const data = { staff: [makeStaff()] };
    const dateRange = { from: new Date('2025-01-01'), to: new Date('2025-06-30') };
    const result = calculateStaffTurnover(data, dateRange);
    expect(result.pct).toBe(0);
    expect(result.leavers).toBe(0);
  });

  it('counts leavers in date range', () => {
    const data = {
      staff: [
        makeStaff({ leaving_date: '2025-03-15', active: false }),
        makeStaff({ id: 'S002', name: 'Bob' }),
      ],
    };
    const dateRange = { from: new Date('2025-01-01'), to: new Date('2025-06-30') };
    const result = calculateStaffTurnover(data, dateRange);
    expect(result.leavers).toBe(1);
    expect(result.avgHeadcount).toBe(2);
    expect(result.pct).toBe(50);
  });

  it('excludes leavers outside date range', () => {
    const data = {
      staff: [
        makeStaff({ leaving_date: '2024-06-15', active: false }),
      ],
    };
    const dateRange = { from: new Date('2025-01-01'), to: new Date('2025-06-30') };
    const result = calculateStaffTurnover(data, dateRange);
    expect(result.leavers).toBe(0);
  });
});

// ── calculateTrainingTrend ──────────────────────────────────────────────────

describe('calculateTrainingTrend', () => {
  it('returns 0 trend for identical compliance', () => {
    const data = { staff: [], config: baseConfig(), training: {} };
    const result = calculateTrainingTrend(data, '2025-06-15');
    expect(result.currentPct).toBe(100);
    expect(result.pastPct).toBe(100);
    expect(result.trend).toBe(0);
  });

  it('shows negative trend when training expires between dates', () => {
    // asOfDate = 2025-06-15, pastDate = 2025-03-17 (90 days earlier)
    // Expiry 2025-06-01: at pastDate (76 days away) → COMPLIANT (>60 threshold)
    // At currentDate (14 days past) → EXPIRED
    const staff = makeStaff();
    const config = baseConfig();
    config.training_types = [config.training_types.find(t => t.id === 'fire-safety')];

    const data = {
      staff: [staff],
      config,
      training: {
        S001: {
          'fire-safety': {
            completed: '2024-06-01', expiry: '2025-06-01',
            trainer: 'Test', method: 'classroom',
          },
        },
      },
    };

    const result = calculateTrainingTrend(data, '2025-06-15');
    expect(result.trend).toBeLessThan(0);
    expect(result.currentPct).toBe(0);  // Expired at June 15
    expect(result.pastPct).toBe(100);   // Compliant at March 17
  });

  it('shows zero trend when compliance unchanged', () => {
    // Training valid at both dates
    const staff = makeStaff();
    const config = baseConfig();
    config.training_types = [config.training_types.find(t => t.id === 'fire-safety')];

    const data = {
      staff: [staff],
      config,
      training: {
        S001: {
          'fire-safety': {
            completed: '2025-01-01', expiry: '2026-01-01',
            trainer: 'Test', method: 'classroom',
          },
        },
      },
    };

    const result = calculateTrainingTrend(data, '2025-06-15');
    expect(result.trend).toBe(0);
    expect(result.currentPct).toBe(100);
    expect(result.pastPct).toBe(100);
  });
});

// ── getEvidenceForStatement ─────────────────────────────────────────────────

describe('getEvidenceForStatement', () => {
  const dateRange = { from: new Date('2025-01-01'), to: new Date('2025-06-30') };
  const asOfDate = '2025-06-15';

  it('returns null for unknown statement', () => {
    const data = { config: baseConfig(), staff: [] };
    expect(getEvidenceForStatement('UNKNOWN', data, dateRange, asOfDate)).toBeNull();
  });

  it('returns auto evidence for S6 (training, staffing)', () => {
    const data = {
      config: baseConfig(),
      staff: [makeStaff()],
      training: {},
      supervisions: {},
      onboarding: {},
      care_certificate: {},
      overrides: {},
      cqc_evidence: [],
    };
    const result = getEvidenceForStatement('S6', data, dateRange, asOfDate);
    expect(result).not.toBeNull();
    expect(result.statement.id).toBe('S6');
    expect(result.autoEvidence.length).toBeGreaterThan(0);
    const labels = result.autoEvidence.map(e => e.label);
    expect(labels).toContain('Training Compliance');
  });

  it('includes manual evidence', () => {
    const data = {
      config: baseConfig(),
      staff: [],
      training: {},
      supervisions: {},
      cqc_evidence: [
        { id: 'e1', quality_statement: 'S2', type: 'qualitative', title: 'Test evidence' },
        { id: 'e2', quality_statement: 'S1', type: 'qualitative', title: 'Other statement' },
      ],
    };
    const result = getEvidenceForStatement('S2', data, dateRange, asOfDate);
    expect(result.manualEvidence).toHaveLength(1);
    expect(result.manualEvidence[0].title).toBe('Test evidence');
  });

  it('returns empty manual evidence when none match', () => {
    const data = {
      config: baseConfig(),
      staff: [],
      training: {},
      cqc_evidence: [],
    };
    const result = getEvidenceForStatement('R1', data, dateRange, asOfDate);
    expect(result.manualEvidence).toHaveLength(0);
    // R1 has no autoMetrics, so autoEvidence should be empty too
    expect(result.autoEvidence).toHaveLength(0);
  });
});

// ── getDbsStatusList ────────────────────────────────────────────────────────

describe('getDbsStatusList', () => {
  it('returns empty for no care staff', () => {
    const data = { staff: [makeStaff({ role: 'Admin' })], onboarding: {} };
    expect(getDbsStatusList(data)).toHaveLength(0);
  });

  it('returns Clear status when DBS completed', () => {
    const data = {
      staff: [makeStaff()],
      onboarding: {
        S001: {
          dbs_check: { status: 'completed', dbs_number: '1234567890', afl_status: 'clear' },
          right_to_work: { expiry_date: '2026-01-01' },
        },
      },
    };
    const list = getDbsStatusList(data);
    expect(list).toHaveLength(1);
    expect(list[0].dbsStatus).toBe('Clear');
    expect(list[0].dbsNumber).toBe('***7890');
    expect(list[0].barredListChecked).toBe('Yes');
    expect(list[0].rtwExpiry).toBe('2026-01-01');
  });

  it('returns Missing when no DBS record', () => {
    const data = { staff: [makeStaff()], onboarding: {} };
    const list = getDbsStatusList(data);
    expect(list[0].dbsStatus).toBe('Missing');
    expect(list[0].dbsNumber).toBe('-');
    expect(list[0].barredListChecked).toBe('No');
  });

  it('returns In Progress for pending DBS', () => {
    const data = {
      staff: [makeStaff()],
      onboarding: { S001: { dbs_check: { status: 'in_progress' } } },
    };
    const list = getDbsStatusList(data);
    expect(list[0].dbsStatus).toBe('In Progress');
  });

  it('excludes inactive staff', () => {
    const data = {
      staff: [makeStaff(), makeStaff({ id: 'S002', active: false })],
      onboarding: {},
    };
    expect(getDbsStatusList(data)).toHaveLength(1);
  });
});

// ── calculateComplianceScore ────────────────────────────────────────────────

describe('calculateComplianceScore', () => {
  const dateRange = { from: new Date('2025-06-01'), to: new Date('2025-06-15') };
  const asOfDate = '2025-06-15';

  it('returns a score with band for minimal data', () => {
    const data = {
      config: baseConfig(),
      staff: [],
      training: {},
      overrides: {},
      incidents: [],
      complaints: [],
      complaint_surveys: [],
      maintenance: [],
      ipc_audits: [],
      risk_register: [],
      policy_reviews: [],
      whistleblowing_concerns: [],
      dols: [],
      mca_assessments: [],
      care_certificate: {},
      fire_drills: [],
      supervisions: {},
      appraisals: {},
      onboarding: {},
      cqc_evidence: [],
    };

    const result = calculateComplianceScore(data, dateRange, asOfDate);
    expect(result).toHaveProperty('overallScore');
    expect(result).toHaveProperty('band');
    expect(result).toHaveProperty('metrics');
    expect(typeof result.overallScore).toBe('number');
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.band).toHaveProperty('label');
  });

  it('returns all 18 metric results', () => {
    const data = {
      config: baseConfig(),
      staff: [],
      training: {},
      overrides: {},
      incidents: [],
      complaints: [],
      complaint_surveys: [],
      maintenance: [],
      ipc_audits: [],
      risk_register: [],
      policy_reviews: [],
      whistleblowing_concerns: [],
      dols: [],
      mca_assessments: [],
      care_certificate: {},
      fire_drills: [],
      supervisions: {},
      appraisals: {},
      onboarding: {},
      cqc_evidence: [],
    };

    const result = calculateComplianceScore(data, dateRange, asOfDate);
    for (const m of METRIC_DEFINITIONS) {
      expect(result.metrics).toHaveProperty(m.id);
      expect(result.metrics[m.id]).toHaveProperty('score');
    }
  });

  it('scores higher with complete training data', () => {
    const staff = makeStaff();
    const config = baseConfig();

    // Build full training records
    const records = {};
    for (const t of config.training_types.filter(t => t.active)) {
      records[t.id] = {
        completed: '2025-03-01', expiry: '2026-03-01',
        trainer: 'Test', method: 'classroom',
      };
    }

    const completeData = {
      config,
      staff: [staff],
      training: { S001: records },
      overrides: {},
      incidents: [],
      complaints: [],
      complaint_surveys: [],
      maintenance: [],
      ipc_audits: [],
      risk_register: [],
      policy_reviews: [],
      whistleblowing_concerns: [],
      dols: [],
      mca_assessments: [],
      care_certificate: {},
      fire_drills: [{ id: 'fd1', date: '2025-06-01', time: '14:00', evacuation_time_seconds: 180 }],
      supervisions: { S001: [{ id: 's1', date: '2025-06-01', next_due: '2025-07-15' }] },
      appraisals: { S001: [{ id: 'a1', date: '2025-04-01', next_due: '2026-04-01' }] },
      onboarding: { S001: { dbs_check: { status: 'completed', afl_status: 'clear' } } },
      cqc_evidence: [],
    };

    const emptyData = {
      config,
      staff: [staff],
      training: {},
      overrides: {},
      incidents: [],
      complaints: [],
      complaint_surveys: [],
      maintenance: [],
      ipc_audits: [],
      risk_register: [],
      policy_reviews: [],
      whistleblowing_concerns: [],
      dols: [],
      mca_assessments: [],
      care_certificate: {},
      fire_drills: [],
      supervisions: {},
      appraisals: {},
      onboarding: {},
      cqc_evidence: [],
    };

    const completeResult = calculateComplianceScore(completeData, dateRange, asOfDate);
    const emptyResult = calculateComplianceScore(emptyData, dateRange, asOfDate);
    expect(completeResult.overallScore).toBeGreaterThan(emptyResult.overallScore);
  });
});
