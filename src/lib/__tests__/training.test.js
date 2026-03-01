/**
 * Unit tests for training.js — Training compliance, supervision, appraisals, fire drills.
 *
 * Covers: training status calculation, tiered levels, compliance matrix,
 * supervision tracking, appraisal tracking, fire drill tracking,
 * training blocking reasons.
 */

import { describe, it, expect } from 'vitest';
import {
  getTrainingStatus,
  getRequiredLevel,
  compareLevels,
  buildComplianceMatrix,
  getComplianceStats,
  getTrainingAlerts,
  isInProbation,
  getSupervisionFrequency,
  getSupervisionStatus,
  getSupervisionStats,
  getSupervisionAlerts,
  getAppraisalStatus,
  getAppraisalStats,
  getAppraisalAlerts,
  getFireDrillStatus,
  getFireDrillAlerts,
  getTrainingBlockingReasons,
  getTrainingTypes,
  ensureTrainingDefaults,
  calculateExpiry,
  DEFAULT_TRAINING_TYPES,
  DEFAULT_TRAINING_LEVELS,
  TRAINING_STATUS,
  BLOCKING_TRAINING_TYPES,
  FIRE_DRILL_FREQUENCY_DAYS,
} from '../training.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeStaff(overrides = {}) {
  return { id: 'S001', name: 'Jane Smith', role: 'Carer', active: true, start_date: '2024-06-01', ...overrides };
}

function makeType(overrides = {}) {
  return { id: 'fire-safety', name: 'Fire Safety', category: 'statutory', refresher_months: 12, roles: null, active: true, levels: [], ...overrides };
}

function makeLevelType() {
  return {
    id: 'safeguarding-adults',
    name: 'Safeguarding Adults',
    category: 'statutory',
    refresher_months: 36,
    roles: null,
    active: true,
    levels: [
      { id: 'L1', name: 'Level 1', roles: ['Carer', 'Float Carer', 'Night Carer'] },
      { id: 'L2', name: 'Level 2', roles: ['Senior Carer', 'Float Senior', 'Night Senior'] },
      { id: 'L3', name: 'Level 3', roles: ['Team Lead'] },
    ],
  };
}

const TODAY = '2026-02-28';

// ── Constants ────────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('DEFAULT_TRAINING_TYPES has 25 types', () => {
    expect(DEFAULT_TRAINING_TYPES).toHaveLength(25);
  });

  it('DEFAULT_TRAINING_LEVELS has entries for safeguarding, mca-dols, oliver-mcgowan, dementia', () => {
    const keys = Object.keys(DEFAULT_TRAINING_LEVELS);
    expect(keys).toContain('safeguarding-adults');
    expect(keys).toContain('mca-dols');
    expect(keys).toContain('oliver-mcgowan');
    expect(keys).toContain('dementia-awareness');
  });

  it('BLOCKING_TRAINING_TYPES are fire-safety, moving-handling, safeguarding-adults', () => {
    expect(BLOCKING_TRAINING_TYPES).toEqual(['fire-safety', 'moving-handling', 'safeguarding-adults']);
  });

  it('FIRE_DRILL_FREQUENCY_DAYS is 91 (quarterly)', () => {
    expect(FIRE_DRILL_FREQUENCY_DAYS).toBe(91);
  });

  it('TRAINING_STATUS has all expected values', () => {
    expect(TRAINING_STATUS.NOT_REQUIRED).toBeDefined();
    expect(TRAINING_STATUS.COMPLIANT).toBeDefined();
    expect(TRAINING_STATUS.EXPIRED).toBeDefined();
    expect(TRAINING_STATUS.WRONG_LEVEL).toBeDefined();
  });
});

// ── calculateExpiry ──────────────────────────────────────────────────────────

describe('calculateExpiry', () => {
  it('adds refresher months correctly', () => {
    expect(calculateExpiry('2025-01-15', 12)).toBe('2026-01-15');
  });

  it('handles month boundary (Jan 31 + 1 month = Feb 28)', () => {
    expect(calculateExpiry('2025-01-31', 1)).toBe('2025-02-28');
  });

  it('handles year rollover', () => {
    expect(calculateExpiry('2025-12-15', 1)).toBe('2026-01-15');
  });

  it('handles leap year (Jan 31 + 1 = Feb 29)', () => {
    expect(calculateExpiry('2028-01-31', 1)).toBe('2028-02-29');
  });
});

// ── getRequiredLevel ─────────────────────────────────────────────────────────

describe('getRequiredLevel', () => {
  const type = makeLevelType();

  it('returns highest matching level for role', () => {
    const level = getRequiredLevel(type, 'Senior Carer');
    expect(level.id).toBe('L2');
  });

  it('returns L1 for Carer', () => {
    const level = getRequiredLevel(type, 'Carer');
    expect(level.id).toBe('L1');
  });

  it('returns L3 for Team Lead', () => {
    const level = getRequiredLevel(type, 'Team Lead');
    expect(level.id).toBe('L3');
  });

  it('returns null for role not in any level', () => {
    const level = getRequiredLevel(type, 'Kitchen Staff');
    expect(level).toBeNull();
  });

  it('returns null when type has no levels', () => {
    const noLevels = makeType({ levels: [] });
    expect(getRequiredLevel(noLevels, 'Carer')).toBeNull();
  });
});

// ── compareLevels ────────────────────────────────────────────────────────────

describe('compareLevels', () => {
  const type = makeLevelType();

  it('returns -1 when A < B', () => {
    expect(compareLevels(type, 'L1', 'L2')).toBe(-1);
  });

  it('returns 1 when A > B', () => {
    expect(compareLevels(type, 'L3', 'L1')).toBe(1);
  });

  it('returns 0 when equal', () => {
    expect(compareLevels(type, 'L2', 'L2')).toBe(0);
  });

  it('returns 0 when type has no levels', () => {
    expect(compareLevels(makeType(), 'L1', 'L2')).toBe(0);
  });

  it('returns -1 when A is unknown', () => {
    expect(compareLevels(type, 'UNKNOWN', 'L2')).toBe(-1);
  });

  it('returns 1 when B is unknown', () => {
    expect(compareLevels(type, 'L2', 'UNKNOWN')).toBe(1);
  });
});

// ── getTrainingStatus ────────────────────────────────────────────────────────

describe('getTrainingStatus', () => {
  const staff = makeStaff();

  it('returns NOT_REQUIRED when type not applicable to role', () => {
    const type = makeType({ roles: ['Night Senior', 'Night Carer'] });
    const result = getTrainingStatus(staff, type, {}, TODAY);
    expect(result.status).toBe(TRAINING_STATUS.NOT_REQUIRED);
  });

  it('returns NOT_STARTED when no record', () => {
    const type = makeType();
    const result = getTrainingStatus(staff, type, {}, TODAY);
    expect(result.status).toBe(TRAINING_STATUS.NOT_STARTED);
  });

  it('returns COMPLIANT when completed and not near expiry', () => {
    const type = makeType();
    const records = { 'fire-safety': { completed: '2025-06-15', expiry: '2026-06-15' } };
    const result = getTrainingStatus(staff, type, records, TODAY);
    expect(result.status).toBe(TRAINING_STATUS.COMPLIANT);
    expect(result.daysUntilExpiry).toBeGreaterThan(60);
  });

  it('returns EXPIRING_SOON when 31-60 days until expiry', () => {
    const type = makeType();
    const records = { 'fire-safety': { completed: '2025-04-15', expiry: '2026-04-15' } };
    const result = getTrainingStatus(staff, type, records, TODAY);
    // 2026-02-28 to 2026-04-15 = ~46 days → EXPIRING_SOON
    expect(result.status).toBe(TRAINING_STATUS.EXPIRING_SOON);
  });

  it('returns URGENT when 0-30 days until expiry', () => {
    const type = makeType();
    const records = { 'fire-safety': { completed: '2025-03-15', expiry: '2026-03-15' } };
    const result = getTrainingStatus(staff, type, records, TODAY);
    // 2026-02-28 to 2026-03-15 = 15 days → URGENT
    expect(result.status).toBe(TRAINING_STATUS.URGENT);
  });

  it('returns EXPIRED when past expiry date', () => {
    const type = makeType();
    const records = { 'fire-safety': { completed: '2024-01-15', expiry: '2025-01-15' } };
    const result = getTrainingStatus(staff, type, records, TODAY);
    expect(result.status).toBe(TRAINING_STATUS.EXPIRED);
    expect(result.daysUntilExpiry).toBeLessThan(0);
  });

  it('returns WRONG_LEVEL when staff level lower than required', () => {
    const type = makeLevelType();
    const seniorStaff = makeStaff({ role: 'Senior Carer' });
    const records = { 'safeguarding-adults': { completed: '2025-06-15', expiry: '2028-06-15', level: 'L1' } };
    const result = getTrainingStatus(seniorStaff, type, records, TODAY);
    expect(result.status).toBe(TRAINING_STATUS.WRONG_LEVEL);
  });

  it('returns COMPLIANT when staff level matches required', () => {
    const type = makeLevelType();
    const seniorStaff = makeStaff({ role: 'Senior Carer' });
    const records = { 'safeguarding-adults': { completed: '2025-06-15', expiry: '2028-06-15', level: 'L2' } };
    const result = getTrainingStatus(seniorStaff, type, records, TODAY);
    expect(result.status).toBe(TRAINING_STATUS.COMPLIANT);
  });

  it('returns WRONG_LEVEL when record has no level for tiered type', () => {
    const type = makeLevelType();
    const records = { 'safeguarding-adults': { completed: '2025-06-15', expiry: '2028-06-15' } };
    const result = getTrainingStatus(staff, type, records, TODAY);
    expect(result.status).toBe(TRAINING_STATUS.WRONG_LEVEL);
  });

  it('NOT_REQUIRED for inactive type', () => {
    const type = makeType({ active: false });
    const result = getTrainingStatus(staff, type, {}, TODAY);
    expect(result.status).toBe(TRAINING_STATUS.NOT_REQUIRED);
  });
});

// ── buildComplianceMatrix + getComplianceStats ───────────────────────────────

describe('buildComplianceMatrix & getComplianceStats', () => {
  it('builds matrix for staff × active types', () => {
    const staff = [makeStaff(), makeStaff({ id: 'S002', name: 'Bob' })];
    const types = [makeType(), makeType({ id: 'moving-handling', name: 'Manual Handling' })];
    const trainingData = {};
    const matrix = buildComplianceMatrix(staff, types, trainingData, TODAY);

    expect(matrix.size).toBe(2);
    expect(matrix.get('S001').size).toBe(2);
  });

  it('skips inactive types', () => {
    const staff = [makeStaff()];
    const types = [makeType(), makeType({ id: 'inactive', active: false })];
    const matrix = buildComplianceMatrix(staff, types, {}, TODAY);
    expect(matrix.get('S001').size).toBe(1);
  });

  it('getComplianceStats counts correctly', () => {
    const staff = [makeStaff()];
    const types = [makeType()];
    const training = { S001: { 'fire-safety': { completed: '2025-06-15', expiry: '2026-06-15' } } };
    const matrix = buildComplianceMatrix(staff, types, training, TODAY);
    const stats = getComplianceStats(matrix);

    expect(stats.totalRequired).toBe(1);
    expect(stats.compliant).toBe(1);
    expect(stats.compliancePct).toBe(100);
  });

  it('returns 100% for empty matrix', () => {
    const stats = getComplianceStats(new Map());
    expect(stats.compliancePct).toBe(100);
    expect(stats.totalRequired).toBe(0);
  });

  it('counts expired correctly', () => {
    const staff = [makeStaff()];
    const types = [makeType()];
    const training = { S001: { 'fire-safety': { completed: '2024-01-15', expiry: '2025-01-15' } } };
    const matrix = buildComplianceMatrix(staff, types, training, TODAY);
    const stats = getComplianceStats(matrix);

    expect(stats.expired).toBe(1);
    expect(stats.compliant).toBe(0);
    expect(stats.compliancePct).toBe(0);
  });
});

// ── getTrainingAlerts ────────────────────────────────────────────────────────

describe('getTrainingAlerts', () => {
  it('generates error alert for expired training', () => {
    const staff = [makeStaff()];
    const types = [makeType()];
    const training = { S001: { 'fire-safety': { completed: '2024-01-15', expiry: '2025-01-15' } } };
    const alerts = getTrainingAlerts(staff, types, training, TODAY);

    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].type).toBe('error');
    expect(alerts[0].msg).toContain('Jane Smith');
    expect(alerts[0].msg).toContain('expired');
  });

  it('generates warning for expiring soon', () => {
    const staff = [makeStaff()];
    const types = [makeType()];
    const training = { S001: { 'fire-safety': { completed: '2025-04-15', expiry: '2026-04-15' } } };
    const alerts = getTrainingAlerts(staff, types, training, TODAY);

    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].type).toBe('warning');
    expect(alerts[0].msg).toContain('expires in');
  });

  it('returns no alerts when all compliant', () => {
    const staff = [makeStaff()];
    const types = [makeType()];
    const training = { S001: { 'fire-safety': { completed: '2025-06-15', expiry: '2026-06-15' } } };
    const alerts = getTrainingAlerts(staff, types, training, TODAY);
    expect(alerts).toHaveLength(0);
  });
});

// ── isInProbation ────────────────────────────────────────────────────────────

describe('isInProbation', () => {
  const config = { supervision_probation_months: 6 };

  it('returns true during probation period', () => {
    const staff = makeStaff({ start_date: '2026-01-01' });
    expect(isInProbation(staff, config, TODAY)).toBe(true);
  });

  it('returns false after probation period', () => {
    const staff = makeStaff({ start_date: '2024-01-01' });
    expect(isInProbation(staff, config, TODAY)).toBe(false);
  });

  it('returns false when no start_date', () => {
    const staff = makeStaff({ start_date: null });
    expect(isInProbation(staff, config, TODAY)).toBe(false);
  });

  it('defaults to 6 months when not configured', () => {
    const staff = makeStaff({ start_date: '2025-10-01' });
    expect(isInProbation(staff, {}, TODAY)).toBe(true); // 5 months in
  });
});

// ── getSupervisionFrequency ──────────────────────────────────────────────────

describe('getSupervisionFrequency', () => {
  it('returns 30 days during probation', () => {
    const staff = makeStaff({ start_date: '2026-01-01' });
    const config = { supervision_frequency_probation: 30, supervision_frequency_standard: 49, supervision_probation_months: 6 };
    expect(getSupervisionFrequency(staff, config, TODAY)).toBe(30);
  });

  it('returns 49 days after probation', () => {
    const staff = makeStaff({ start_date: '2024-01-01' });
    const config = { supervision_frequency_probation: 30, supervision_frequency_standard: 49, supervision_probation_months: 6 };
    expect(getSupervisionFrequency(staff, config, TODAY)).toBe(49);
  });
});

// ── getSupervisionStatus ─────────────────────────────────────────────────────

describe('getSupervisionStatus', () => {
  const staff = makeStaff({ start_date: '2024-01-01' });
  const config = { supervision_frequency_probation: 30, supervision_frequency_standard: 49, supervision_probation_months: 6 };

  it('returns not_started when no sessions', () => {
    const result = getSupervisionStatus(staff, config, {}, TODAY);
    expect(result.status).toBe('not_started');
  });

  it('returns up_to_date when recently supervised', () => {
    const sups = { S001: [{ date: '2026-02-15', supervisor: 'Manager' }] };
    const result = getSupervisionStatus(staff, config, sups, TODAY);
    // Next due: 2026-02-15 + 49 days = ~2026-04-05 — well within range
    expect(result.status).toBe('up_to_date');
  });

  it('returns overdue when long since supervision', () => {
    const sups = { S001: [{ date: '2025-06-01', supervisor: 'Manager' }] };
    const result = getSupervisionStatus(staff, config, sups, TODAY);
    // Next due: 2025-06-01 + 49 = ~2025-07-20 — very overdue
    expect(result.status).toBe('overdue');
  });

  it('returns due_soon when near due date', () => {
    // Next due needs to be 0-14 days away
    const supDate = '2026-01-25'; // + 49 days = 2026-03-15 — 15 days away → due_soon (0-14) hmm
    // Let me calculate: 2026-01-25 + 49 = 2026-03-15. From 2026-02-28, that's 15 days.
    // Status boundary: >14 = up_to_date, so at 15 days it's still up_to_date
    // Need < 14: 2026-01-12 + 49 = 2026-03-02 — 2 days away → due_soon
    const sups = { S001: [{ date: '2026-01-12', supervisor: 'Manager' }] };
    const result = getSupervisionStatus(staff, config, sups, TODAY);
    expect(result.status).toBe('due_soon');
  });
});

// ── getSupervisionStats ──────────────────────────────────────────────────────

describe('getSupervisionStats', () => {
  const config = { supervision_frequency_probation: 30, supervision_frequency_standard: 49, supervision_probation_months: 6 };

  it('counts by status category', () => {
    const staff = [
      makeStaff({ id: 'S001', start_date: '2024-01-01' }),
      makeStaff({ id: 'S002', name: 'Bob', start_date: '2024-01-01' }),
    ];
    const sups = {
      S001: [{ date: '2026-02-15', supervisor: 'Mgr' }],
      // S002: no sessions
    };
    const stats = getSupervisionStats(staff, config, sups, TODAY);
    expect(stats.total).toBe(2);
    expect(stats.upToDate).toBe(1);
    expect(stats.notStarted).toBe(1);
  });

  it('returns 100% for empty staff list', () => {
    const stats = getSupervisionStats([], config, {}, TODAY);
    expect(stats.completionPct).toBe(100);
  });
});

// ── Appraisal tracking ──────────────────────────────────────────────────────

describe('getAppraisalStatus', () => {
  const staff = makeStaff();

  it('returns not_started when no appraisals', () => {
    const result = getAppraisalStatus(staff, {}, TODAY);
    expect(result.status).toBe('not_started');
  });

  it('returns up_to_date when recently appraised', () => {
    const aprs = { S001: [{ date: '2026-01-15', next_due: '2027-01-15' }] };
    const result = getAppraisalStatus(staff, aprs, TODAY);
    expect(result.status).toBe('up_to_date');
  });

  it('returns overdue when past due date', () => {
    const aprs = { S001: [{ date: '2024-06-15', next_due: '2025-06-15' }] };
    const result = getAppraisalStatus(staff, aprs, TODAY);
    expect(result.status).toBe('overdue');
  });

  it('calculates next_due from date + 1 year when not provided', () => {
    const aprs = { S001: [{ date: '2025-06-15' }] };
    const result = getAppraisalStatus(staff, aprs, TODAY);
    // next_due = 2026-06-15, ~107 days away → up_to_date
    expect(result.status).toBe('up_to_date');
    expect(result.nextDue).toMatch(/2026-06/);
  });

  it('returns due_soon when 0-30 days until due', () => {
    const aprs = { S001: [{ date: '2025-03-10', next_due: '2026-03-10' }] };
    const result = getAppraisalStatus(staff, aprs, TODAY);
    // 2026-02-28 to 2026-03-10 = 10 days → due_soon
    expect(result.status).toBe('due_soon');
  });
});

describe('getAppraisalStats', () => {
  it('returns correct counts', () => {
    const staff = [makeStaff(), makeStaff({ id: 'S002', name: 'Bob' })];
    const aprs = { S001: [{ date: '2026-01-15', next_due: '2027-01-15' }] };
    const stats = getAppraisalStats(staff, aprs, TODAY);
    expect(stats.total).toBe(2);
    expect(stats.upToDate).toBe(1);
    expect(stats.notStarted).toBe(1);
  });
});

// ── Fire drill tracking ──────────────────────────────────────────────────────

describe('getFireDrillStatus', () => {
  it('returns not_started when no drills', () => {
    const result = getFireDrillStatus([], TODAY);
    expect(result.status).toBe('not_started');
  });

  it('returns up_to_date when recent drill', () => {
    const drills = [{ date: '2026-02-15', evacuation_time_seconds: 180 }];
    const result = getFireDrillStatus(drills, TODAY);
    expect(result.status).toBe('up_to_date');
  });

  it('returns overdue when drill too old', () => {
    const drills = [{ date: '2025-06-01', evacuation_time_seconds: 240 }];
    const result = getFireDrillStatus(drills, TODAY);
    // 2025-06-01 + 91 days = ~2025-08-31 — very overdue
    expect(result.status).toBe('overdue');
  });

  it('counts drills in last 12 months', () => {
    const drills = [
      { date: '2025-06-01', evacuation_time_seconds: 180 },
      { date: '2025-09-01', evacuation_time_seconds: 200 },
      { date: '2025-12-01', evacuation_time_seconds: 190 },
      { date: '2026-02-01', evacuation_time_seconds: 160 },
    ];
    const result = getFireDrillStatus(drills, TODAY);
    expect(result.drillsThisYear).toBe(4);
  });

  it('calculates average evacuation time', () => {
    const drills = [
      { date: '2026-02-01', evacuation_time_seconds: 180 },
      { date: '2026-01-01', evacuation_time_seconds: 220 },
    ];
    const result = getFireDrillStatus(drills, TODAY);
    expect(result.avgEvacTime).toBe(200);
  });

  it('handles drills with zero/missing evacuation time', () => {
    const drills = [{ date: '2026-02-01', evacuation_time_seconds: 0 }];
    const result = getFireDrillStatus(drills, TODAY);
    expect(result.avgEvacTime).toBeNull();
  });
});

describe('getFireDrillAlerts', () => {
  it('alerts when overdue', () => {
    const drills = [{ date: '2025-06-01' }];
    const alerts = getFireDrillAlerts(drills, TODAY);
    expect(alerts.some(a => a.type === 'error')).toBe(true);
  });

  it('alerts when fewer than 4 drills in 12 months', () => {
    const drills = [{ date: '2026-02-01' }];
    const alerts = getFireDrillAlerts(drills, TODAY);
    expect(alerts.some(a => a.msg.includes('minimum 4'))).toBe(true);
  });

  it('alerts for no drills recorded', () => {
    const alerts = getFireDrillAlerts([], TODAY);
    expect(alerts.some(a => a.msg.includes('No fire drills'))).toBe(true);
  });

  it('no alerts when 4+ drills and recent', () => {
    const drills = [
      { date: '2025-06-01', evacuation_time_seconds: 180 },
      { date: '2025-09-01', evacuation_time_seconds: 200 },
      { date: '2025-12-01', evacuation_time_seconds: 190 },
      { date: '2026-02-15', evacuation_time_seconds: 160 },
    ];
    const alerts = getFireDrillAlerts(drills, TODAY);
    expect(alerts).toHaveLength(0);
  });
});

// ── getTrainingBlockingReasons ───────────────────────────────────────────────

describe('getTrainingBlockingReasons', () => {
  const config = {
    training_types: [
      makeType({ id: 'fire-safety', name: 'Fire Safety', refresher_months: 12 }),
      makeType({ id: 'moving-handling', name: 'Manual Handling', refresher_months: 12 }),
      makeLevelType(), // safeguarding-adults
    ],
  };

  it('returns empty array when all blocking types completed', () => {
    const training = {
      S001: {
        'fire-safety': { completed: '2025-06-15', expiry: '2026-06-15' },
        'moving-handling': { completed: '2025-06-15', expiry: '2026-06-15' },
        'safeguarding-adults': { completed: '2025-06-15', expiry: '2028-06-15' },
      },
    };
    const reasons = getTrainingBlockingReasons('S001', 'Carer', training, config, TODAY);
    expect(reasons).toHaveLength(0);
  });

  it('returns reason for missing training', () => {
    const training = { S001: {} };
    const reasons = getTrainingBlockingReasons('S001', 'Carer', training, config, TODAY);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.some(r => r.includes('not completed'))).toBe(true);
  });

  it('returns reason for expired training', () => {
    const training = {
      S001: {
        'fire-safety': { completed: '2024-01-15', expiry: '2025-01-15' },
        'moving-handling': { completed: '2025-06-15', expiry: '2026-06-15' },
        'safeguarding-adults': { completed: '2025-06-15', expiry: '2028-06-15' },
      },
    };
    const reasons = getTrainingBlockingReasons('S001', 'Carer', training, config, TODAY);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('expired');
  });

  it('returns empty for no training data', () => {
    const reasons = getTrainingBlockingReasons('S099', 'Carer', {}, config, TODAY);
    expect(reasons.length).toBeGreaterThan(0); // Missing = blocked
  });
});

// ── getTrainingTypes ─────────────────────────────────────────────────────────

describe('getTrainingTypes', () => {
  it('returns config types when present', () => {
    const types = [makeType()];
    const result = getTrainingTypes({ training_types: types });
    expect(result).toBe(types);
  });

  it('returns defaults when config has no types', () => {
    const result = getTrainingTypes({});
    expect(result).toBe(DEFAULT_TRAINING_TYPES);
  });
});

// ── ensureTrainingDefaults ───────────────────────────────────────────────────

describe('ensureTrainingDefaults', () => {
  it('populates training_types on empty data', () => {
    const data = { config: {} };
    const result = ensureTrainingDefaults(data);
    expect(result).not.toBeNull();
    expect(result.config.training_types.length).toBe(25);
  });

  it('adds training/supervisions/appraisals/fire_drills', () => {
    const data = { config: {} };
    const result = ensureTrainingDefaults(data);
    expect(result.training).toBeDefined();
    expect(result.supervisions).toBeDefined();
    expect(result.appraisals).toBeDefined();
    expect(result.fire_drills).toBeDefined();
  });

  it('returns null when no changes needed', () => {
    const data = {
      config: { training_types: DEFAULT_TRAINING_TYPES.map(t => ({ ...t })) },
      training: {},
      supervisions: {},
      appraisals: {},
      fire_drills: [],
    };
    // Ensure levels are present
    for (const t of data.config.training_types) {
      if (DEFAULT_TRAINING_LEVELS[t.id]) t.levels = DEFAULT_TRAINING_LEVELS[t.id];
    }
    const result = ensureTrainingDefaults(data);
    expect(result).toBeNull();
  });
});
