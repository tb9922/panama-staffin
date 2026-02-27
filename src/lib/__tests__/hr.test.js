import { describe, it, expect } from 'vitest';
import {
  getStatusBadge, getAbsenceTriggerBadge, getHrAlerts,
  DISCIPLINARY_CATEGORIES, DISCIPLINARY_STATUSES, DISCIPLINARY_OUTCOMES,
  GRIEVANCE_CATEGORIES, GRIEVANCE_STATUSES,
  PERFORMANCE_TYPES, PERFORMANCE_STATUSES,
  CONTRACT_TYPES, CONTRACT_STATUSES,
  FAMILY_LEAVE_TYPES, FAMILY_LEAVE_STATUSES,
  FLEX_WORKING_STATUSES, FLEX_REFUSAL_REASONS,
  EDI_RECORD_TYPES, EDI_STATUSES,
  TUPE_STATUSES, RENEWAL_CHECK_TYPES, RENEWAL_STATUSES,
  BRADFORD_TRIGGERS, CASE_NOTE_TYPES, WARNING_LEVELS,
} from '../hr.js';

// ── getStatusBadge ──────────────────────────────────────────────────────────────

describe('getStatusBadge', () => {
  it('returns correct badge for a known disciplinary status', () => {
    expect(getStatusBadge('open', DISCIPLINARY_STATUSES)).toBe('blue');
    expect(getStatusBadge('investigation', DISCIPLINARY_STATUSES)).toBe('amber');
    expect(getStatusBadge('closed', DISCIPLINARY_STATUSES)).toBe('gray');
  });

  it('returns correct badge for a known contract status', () => {
    expect(getStatusBadge('active', CONTRACT_STATUSES)).toBe('green');
    expect(getStatusBadge('terminated', CONTRACT_STATUSES)).toBe('red');
  });

  it('returns gray for an unknown status ID', () => {
    expect(getStatusBadge('nonexistent', DISCIPLINARY_STATUSES)).toBe('gray');
  });

  it('returns gray for undefined status ID', () => {
    expect(getStatusBadge(undefined, DISCIPLINARY_STATUSES)).toBe('gray');
  });

  it('returns gray for null status ID', () => {
    expect(getStatusBadge(null, GRIEVANCE_STATUSES)).toBe('gray');
  });

  it('works across different status lists', () => {
    expect(getStatusBadge('open', GRIEVANCE_STATUSES)).toBe('blue');
    expect(getStatusBadge('planned', FAMILY_LEAVE_STATUSES)).toBe('blue');
    expect(getStatusBadge('pending', FLEX_WORKING_STATUSES)).toBe('blue');
    expect(getStatusBadge('escalated', EDI_STATUSES)).toBe('red');
    expect(getStatusBadge('consultation', TUPE_STATUSES)).toBe('amber');
    expect(getStatusBadge('overdue', RENEWAL_STATUSES)).toBe('red');
  });
});

// ── getAbsenceTriggerBadge ──────────────────────────────────────────────────────

describe('getAbsenceTriggerBadge', () => {
  it('returns amber entry for informal trigger level', () => {
    const result = getAbsenceTriggerBadge('informal');
    expect(result.badgeKey).toBe('amber');
    expect(result.level).toBe('informal');
  });

  it('returns red entry for final trigger level', () => {
    const result = getAbsenceTriggerBadge('final');
    expect(result.badgeKey).toBe('red');
    expect(result.level).toBe('final');
  });

  it('returns green entry for none trigger level', () => {
    const result = getAbsenceTriggerBadge('none');
    expect(result.badgeKey).toBe('green');
    expect(result.level).toBe('none');
  });

  it('returns red entry for stage_1', () => {
    const result = getAbsenceTriggerBadge('stage_1');
    expect(result.badgeKey).toBe('amber');
    expect(result.level).toBe('stage_1');
  });

  it('returns red entry for stage_2', () => {
    const result = getAbsenceTriggerBadge('stage_2');
    expect(result.badgeKey).toBe('red');
    expect(result.level).toBe('stage_2');
  });

  it('falls back to last entry (green/none) for unknown trigger level', () => {
    const result = getAbsenceTriggerBadge('unknown_level');
    expect(result.badgeKey).toBe('green');
    expect(result.level).toBe('none');
  });

  it('falls back to last entry for undefined trigger level', () => {
    const result = getAbsenceTriggerBadge(undefined);
    expect(result.badgeKey).toBe('green');
    expect(result.level).toBe('none');
  });
});

// ── getHrAlerts ─────────────────────────────────────────────────────────────────

describe('getHrAlerts', () => {
  it('returns empty array when stats is null', () => {
    expect(getHrAlerts(null, [])).toEqual([]);
  });

  it('returns empty array when stats is undefined', () => {
    expect(getHrAlerts(undefined, [])).toEqual([]);
  });

  it('returns empty array when all stats are zero', () => {
    const stats = {
      open_disciplinary: 0, open_grievance: 0, open_performance: 0,
      pending_flex: 0, active_warnings: 0,
    };
    expect(getHrAlerts(stats, [])).toEqual([]);
  });

  it('generates alert for open disciplinary cases', () => {
    const stats = { open_disciplinary: 1, open_grievance: 0, open_performance: 0, pending_flex: 0, active_warnings: 0 };
    const alerts = getHrAlerts(stats, []);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('hr-disc');
    expect(alerts[0].type).toBe('hr');
    expect(alerts[0].label).toContain('1 open disciplinary case');
  });

  it('uses amber severity when disciplinary cases <= 2', () => {
    const stats = { open_disciplinary: 2, open_grievance: 0, open_performance: 0, pending_flex: 0, active_warnings: 0 };
    const alerts = getHrAlerts(stats, []);
    expect(alerts[0].severity).toBe('amber');
  });

  it('escalates to red severity when disciplinary cases > 2', () => {
    const stats = { open_disciplinary: 3, open_grievance: 0, open_performance: 0, pending_flex: 0, active_warnings: 0 };
    const alerts = getHrAlerts(stats, []);
    expect(alerts[0].severity).toBe('red');
  });

  it('generates alert for open grievances', () => {
    const stats = { open_disciplinary: 0, open_grievance: 2, open_performance: 0, pending_flex: 0, active_warnings: 0 };
    const alerts = getHrAlerts(stats, []);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('hr-grv');
    expect(alerts[0].severity).toBe('amber');
    expect(alerts[0].label).toContain('2 open grievances');
  });

  it('generates alert for active performance cases', () => {
    const stats = { open_disciplinary: 0, open_grievance: 0, open_performance: 1, pending_flex: 0, active_warnings: 0 };
    const alerts = getHrAlerts(stats, []);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('hr-perf');
    expect(alerts[0].label).toContain('1 active performance case');
  });

  it('generates alert for pending flexible working requests', () => {
    const stats = { open_disciplinary: 0, open_grievance: 0, open_performance: 0, pending_flex: 3, active_warnings: 0 };
    const alerts = getHrAlerts(stats, []);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('hr-flex');
    expect(alerts[0].label).toContain('3 pending flexible working requests');
  });

  it('generates alert for active warnings', () => {
    const stats = { open_disciplinary: 0, open_grievance: 0, open_performance: 0, pending_flex: 0, active_warnings: 2 };
    const alerts = getHrAlerts(stats, []);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('hr-warn');
    expect(alerts[0].severity).toBe('red');
    expect(alerts[0].label).toContain('2 active warnings on register');
  });

  it('generates multiple alerts when multiple stats categories are populated', () => {
    const stats = { open_disciplinary: 1, open_grievance: 1, open_performance: 1, pending_flex: 0, active_warnings: 0 };
    const alerts = getHrAlerts(stats, []);
    expect(alerts).toHaveLength(3);
    const keys = alerts.map(a => a.key);
    expect(keys).toContain('hr-disc');
    expect(keys).toContain('hr-grv');
    expect(keys).toContain('hr-perf');
  });

  it('generates renewal alert from warnings array', () => {
    const stats = { open_disciplinary: 0, open_grievance: 0, open_performance: 0, pending_flex: 0, active_warnings: 0 };
    const warnings = [
      { type: 'renewal_overdue', staff_id: 'S001' },
      { type: 'renewal_overdue', staff_id: 'S002' },
    ];
    const alerts = getHrAlerts(stats, warnings);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('hr-renew');
    expect(alerts[0].severity).toBe('red');
    expect(alerts[0].label).toContain('2 overdue DBS/RTW renewals');
  });

  it('ignores non-renewal_overdue warning types', () => {
    const stats = { open_disciplinary: 0, open_grievance: 0, open_performance: 0, pending_flex: 0, active_warnings: 0 };
    const warnings = [{ type: 'some_other_type', staff_id: 'S001' }];
    const alerts = getHrAlerts(stats, warnings);
    expect(alerts).toHaveLength(0);
  });

  it('handles warnings being null/undefined', () => {
    const stats = { open_disciplinary: 1, open_grievance: 0, open_performance: 0, pending_flex: 0, active_warnings: 0 };
    const alerts = getHrAlerts(stats, null);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('hr-disc');
  });

  it('pluralises correctly for singular counts', () => {
    const stats = { open_disciplinary: 1, open_grievance: 1, open_performance: 1, pending_flex: 1, active_warnings: 1 };
    const alerts = getHrAlerts(stats, []);
    const disc = alerts.find(a => a.key === 'hr-disc');
    const grv = alerts.find(a => a.key === 'hr-grv');
    const warn = alerts.find(a => a.key === 'hr-warn');
    expect(disc.label).toBe('1 open disciplinary case');
    expect(grv.label).toBe('1 open grievance');
    expect(warn.label).toBe('1 active warning on register');
  });

  it('pluralises correctly for multiple counts', () => {
    const stats = { open_disciplinary: 4, open_grievance: 5, open_performance: 2, pending_flex: 3, active_warnings: 6 };
    const alerts = getHrAlerts(stats, []);
    const disc = alerts.find(a => a.key === 'hr-disc');
    const grv = alerts.find(a => a.key === 'hr-grv');
    const warn = alerts.find(a => a.key === 'hr-warn');
    expect(disc.label).toBe('4 open disciplinary cases');
    expect(grv.label).toBe('5 open grievances');
    expect(warn.label).toBe('6 active warnings on register');
  });
});

// ── Constants ───────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('DISCIPLINARY_CATEGORIES has items with id and name', () => {
    expect(DISCIPLINARY_CATEGORIES.length).toBeGreaterThan(0);
    for (const cat of DISCIPLINARY_CATEGORIES) {
      expect(cat).toHaveProperty('id');
      expect(cat).toHaveProperty('name');
      expect(typeof cat.id).toBe('string');
      expect(typeof cat.name).toBe('string');
    }
  });

  it('DISCIPLINARY_STATUSES has items with id, name, and badgeKey', () => {
    expect(DISCIPLINARY_STATUSES.length).toBeGreaterThan(0);
    for (const s of DISCIPLINARY_STATUSES) {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('badgeKey');
    }
  });

  it('DISCIPLINARY_OUTCOMES has expected outcome ids', () => {
    const ids = DISCIPLINARY_OUTCOMES.map(o => o.id);
    expect(ids).toContain('no_action');
    expect(ids).toContain('dismissal');
    expect(ids).toContain('first_written');
    expect(ids).toContain('final_written');
  });

  it('GRIEVANCE_CATEGORIES has items with id and name', () => {
    expect(GRIEVANCE_CATEGORIES.length).toBeGreaterThan(0);
    for (const cat of GRIEVANCE_CATEGORIES) {
      expect(cat).toHaveProperty('id');
      expect(cat).toHaveProperty('name');
    }
  });

  it('GRIEVANCE_STATUSES has items with badgeKey', () => {
    for (const s of GRIEVANCE_STATUSES) {
      expect(s).toHaveProperty('badgeKey');
    }
  });

  it('PERFORMANCE_TYPES includes capability and pip', () => {
    const ids = PERFORMANCE_TYPES.map(t => t.id);
    expect(ids).toContain('capability');
    expect(ids).toContain('pip');
  });

  it('PERFORMANCE_STATUSES has items with badgeKey', () => {
    for (const s of PERFORMANCE_STATUSES) {
      expect(s).toHaveProperty('badgeKey');
    }
  });

  it('CONTRACT_TYPES includes permanent and zero_hours', () => {
    const ids = CONTRACT_TYPES.map(t => t.id);
    expect(ids).toContain('permanent');
    expect(ids).toContain('zero_hours');
  });

  it('CONTRACT_STATUSES has items with badgeKey', () => {
    for (const s of CONTRACT_STATUSES) {
      expect(s).toHaveProperty('badgeKey');
    }
  });

  it('FAMILY_LEAVE_TYPES includes maternity and paternity', () => {
    const ids = FAMILY_LEAVE_TYPES.map(t => t.id);
    expect(ids).toContain('maternity');
    expect(ids).toContain('paternity');
    expect(ids).toContain('neonatal');
  });

  it('FAMILY_LEAVE_STATUSES has items with badgeKey', () => {
    for (const s of FAMILY_LEAVE_STATUSES) {
      expect(s).toHaveProperty('badgeKey');
    }
  });

  it('FLEX_REFUSAL_REASONS has exactly 8 statutory reasons', () => {
    expect(FLEX_REFUSAL_REASONS).toHaveLength(8);
    for (const r of FLEX_REFUSAL_REASONS) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('name');
    }
  });

  it('FLEX_WORKING_STATUSES has items with badgeKey', () => {
    for (const s of FLEX_WORKING_STATUSES) {
      expect(s).toHaveProperty('badgeKey');
    }
  });

  it('EDI_RECORD_TYPES has expected types', () => {
    const ids = EDI_RECORD_TYPES.map(t => t.id);
    expect(ids).toContain('harassment_complaint');
    expect(ids).toContain('reasonable_adjustment');
  });

  it('EDI_STATUSES has items with badgeKey', () => {
    for (const s of EDI_STATUSES) {
      expect(s).toHaveProperty('badgeKey');
    }
  });

  it('TUPE_STATUSES has items with badgeKey', () => {
    for (const s of TUPE_STATUSES) {
      expect(s).toHaveProperty('badgeKey');
    }
  });

  it('RENEWAL_CHECK_TYPES includes dbs and rtw', () => {
    const ids = RENEWAL_CHECK_TYPES.map(t => t.id);
    expect(ids).toContain('dbs');
    expect(ids).toContain('rtw');
  });

  it('RENEWAL_STATUSES has items with badgeKey', () => {
    for (const s of RENEWAL_STATUSES) {
      expect(s).toHaveProperty('badgeKey');
    }
  });

  it('CASE_NOTE_TYPES has exactly 11 entries', () => {
    expect(CASE_NOTE_TYPES).toHaveLength(11);
    expect(CASE_NOTE_TYPES).toContain('disciplinary');
    expect(CASE_NOTE_TYPES).toContain('grievance');
    expect(CASE_NOTE_TYPES).toContain('tupe');
    expect(CASE_NOTE_TYPES).toContain('renewal');
  });

  it('BRADFORD_TRIGGERS is sorted descending by threshold', () => {
    for (let i = 1; i < BRADFORD_TRIGGERS.length; i++) {
      expect(BRADFORD_TRIGGERS[i - 1].threshold).toBeGreaterThan(BRADFORD_TRIGGERS[i].threshold);
    }
  });

  it('BRADFORD_TRIGGERS entries have threshold, level, name, and badgeKey', () => {
    for (const t of BRADFORD_TRIGGERS) {
      expect(t).toHaveProperty('threshold');
      expect(t).toHaveProperty('level');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('badgeKey');
      expect(typeof t.threshold).toBe('number');
    }
  });

  it('WARNING_LEVELS has entries with id, name, and badgeKey', () => {
    expect(WARNING_LEVELS.length).toBeGreaterThan(0);
    for (const w of WARNING_LEVELS) {
      expect(w).toHaveProperty('id');
      expect(w).toHaveProperty('name');
      expect(w).toHaveProperty('badgeKey');
    }
  });

  it('WARNING_LEVELS includes dismissal and first_written', () => {
    const ids = WARNING_LEVELS.map(w => w.id);
    expect(ids).toContain('dismissal');
    expect(ids).toContain('first_written');
    expect(ids).toContain('final_written');
  });
});
