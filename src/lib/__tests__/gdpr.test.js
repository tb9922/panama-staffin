import { describe, it, expect } from 'vitest';
import {
  calculateDeadline, calculateICODeadline, daysUntilDeadline, isOverdue,
  assessBreachRisk, calculateGdprComplianceScore,
  getGdprAlerts, getStatusBadgeKey, getSeverityBadgeKey, formatRequestType,
  REQUEST_TYPES, LEGAL_BASES, DATA_CATEGORIES,
} from '../gdpr.js';

describe('gdpr constants', () => {
  it('has 5 request types', () => {
    expect(REQUEST_TYPES).toHaveLength(5);
    expect(REQUEST_TYPES.map(t => t.id)).toContain('sar');
    expect(REQUEST_TYPES.map(t => t.id)).toContain('erasure');
  });

  it('has 6 legal bases matching GDPR Article 6', () => {
    expect(LEGAL_BASES).toHaveLength(6);
  });

  it('has data categories', () => {
    expect(DATA_CATEGORIES.length).toBeGreaterThan(5);
    expect(DATA_CATEGORIES).toContain('staff_health');
    expect(DATA_CATEGORIES).toContain('dbs');
  });
});

describe('calculateDeadline', () => {
  it('adds 30 days by default', () => {
    expect(calculateDeadline('2025-03-01')).toBe('2025-03-31');
  });

  it('supports custom days', () => {
    expect(calculateDeadline('2025-01-01', 7)).toBe('2025-01-08');
  });

  it('handles month boundaries', () => {
    expect(calculateDeadline('2025-01-15', 30)).toBe('2025-02-14');
  });
});

describe('calculateICODeadline', () => {
  it('adds 72 hours to discovery date', () => {
    const deadline = calculateICODeadline('2025-06-01T10:00:00Z');
    const expected = new Date('2025-06-04T10:00:00Z');
    expect(new Date(deadline).getTime()).toBe(expected.getTime());
  });
});

describe('daysUntilDeadline / isOverdue', () => {
  it('returns positive for future deadlines', () => {
    const future = new Date();
    future.setDate(future.getDate() + 10);
    expect(daysUntilDeadline(future.toISOString().slice(0, 10))).toBeGreaterThan(0);
  });

  it('returns negative for past deadlines', () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    expect(daysUntilDeadline(past.toISOString().slice(0, 10))).toBeLessThan(0);
  });

  it('isOverdue returns true for past deadlines', () => {
    const past = new Date();
    past.setDate(past.getDate() - 1);
    expect(isOverdue(past.toISOString().slice(0, 10))).toBe(true);
  });

  it('isOverdue returns false for future deadlines', () => {
    const future = new Date();
    future.setDate(future.getDate() + 10);
    expect(isOverdue(future.toISOString().slice(0, 10))).toBe(false);
  });
});

describe('assessBreachRisk', () => {
  it('returns low risk for minor breach', () => {
    const result = assessBreachRisk({
      severity: 'low', risk_to_rights: 'unlikely',
      individuals_affected: 1, data_categories: [],
    });
    expect(result.riskLevel).toBe('low');
    expect(result.icoNotifiable).toBe(false);
  });

  it('returns critical risk for serious breach with many affected', () => {
    const result = assessBreachRisk({
      severity: 'high', risk_to_rights: 'likely',
      individuals_affected: 50, data_categories: [],
    });
    // (3 + 3 + 4) / 3 = 3.33 → critical
    expect(result.riskLevel).toBe('critical');
    expect(result.icoNotifiable).toBe(true);
  });

  it('applies special category multiplier for staff health data', () => {
    const withoutSpecial = assessBreachRisk({
      severity: 'medium', risk_to_rights: 'possible',
      individuals_affected: 5, data_categories: ['scheduling'],
    });
    const withSpecial = assessBreachRisk({
      severity: 'medium', risk_to_rights: 'possible',
      individuals_affected: 5, data_categories: ['staff_health'],
    });
    expect(withSpecial.score).toBeGreaterThan(withoutSpecial.score);
    expect(withSpecial.specialCategoryDataInvolved).toBe(true);
    expect(withoutSpecial.specialCategoryDataInvolved).toBe(false);
  });

  it('applies DBS as special category', () => {
    const result = assessBreachRisk({
      severity: 'low', risk_to_rights: 'unlikely',
      individuals_affected: 1, data_categories: ['dbs'],
    });
    expect(result.specialCategoryDataInvolved).toBe(true);
  });

  it('critical severity breach is always ICO notifiable', () => {
    const result = assessBreachRisk({
      severity: 'critical', risk_to_rights: 'high',
      individuals_affected: 100, data_categories: ['staff_health'],
    });
    expect(result.riskLevel).toBe('critical');
    expect(result.icoNotifiable).toBe(true);
  });
});

describe('calculateGdprComplianceScore', () => {
  it('returns 100 with no issues', () => {
    const result = calculateGdprComplianceScore([], [], [], []);
    expect(result.score).toBe(100);
    expect(result.band).toBe('good');
    expect(result.issues).toHaveLength(0);
  });

  it('deducts 10 per overdue request', () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    const requests = [
      { status: 'received', deadline: past.toISOString().slice(0, 10) },
    ];
    const result = calculateGdprComplianceScore(requests, [], [], []);
    expect(result.score).toBe(90);
    expect(result.issues).toHaveLength(1);
  });

  it('deducts 15 per open breach', () => {
    const breaches = [{ status: 'open', ico_notifiable: false }];
    const result = calculateGdprComplianceScore([], breaches, [], []);
    expect(result.score).toBe(85);
  });

  it('deducts 20 per unnotified ICO breach', () => {
    const breaches = [{ status: 'open', ico_notifiable: true, ico_notified: false }];
    const result = calculateGdprComplianceScore([], breaches, [], []);
    // -15 open + -20 unnotified = 65
    expect(result.score).toBe(65);
    expect(result.band).toBe('requires_improvement');
  });

  it('never goes below 0', () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    const requests = Array(20).fill({ status: 'received', deadline: past.toISOString().slice(0, 10) });
    const result = calculateGdprComplianceScore(requests, [], [], []);
    expect(result.score).toBe(0);
    expect(result.band).toBe('inadequate');
  });

  it('completed requests do not count as overdue', () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    const requests = [{ status: 'completed', deadline: past.toISOString().slice(0, 10) }];
    const result = calculateGdprComplianceScore(requests, [], [], []);
    expect(result.score).toBe(100);
  });
});

describe('getGdprAlerts', () => {
  it('returns empty array with no data', () => {
    expect(getGdprAlerts([], [], [])).toHaveLength(0);
  });

  it('generates alert for overdue request', () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    const requests = [{
      request_type: 'sar', subject_name: 'John', subject_id: 'S001',
      status: 'received', deadline: past.toISOString().slice(0, 10),
    }];
    const alerts = getGdprAlerts(requests, [], []);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].severity).toBe('red');
    expect(alerts[0].message).toContain('overdue');
  });

  it('generates amber alert for approaching deadline', () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 3);
    const requests = [{
      request_type: 'erasure', subject_name: 'Jane', subject_id: 'S002',
      status: 'in_progress', deadline: soon.toISOString().slice(0, 10),
    }];
    const alerts = getGdprAlerts(requests, [], []);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].severity).toBe('amber');
  });

  it('generates alert for ICO-involved complaint', () => {
    const complaints = [{ ico_involved: true, status: 'open', category: 'breach' }];
    const alerts = getGdprAlerts([], [], complaints);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].severity).toBe('red');
  });

  it('does not alert for completed requests', () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    const requests = [{
      request_type: 'sar', subject_name: 'John', subject_id: 'S001',
      status: 'completed', deadline: past.toISOString().slice(0, 10),
    }];
    expect(getGdprAlerts(requests, [], [])).toHaveLength(0);
  });
});

describe('display helpers', () => {
  it('getStatusBadgeKey maps statuses correctly', () => {
    expect(getStatusBadgeKey('received')).toBe('blue');
    expect(getStatusBadgeKey('completed')).toBe('green');
    expect(getStatusBadgeKey('open')).toBe('red');
    expect(getStatusBadgeKey('unknown')).toBe('gray');
  });

  it('getSeverityBadgeKey maps severities correctly', () => {
    expect(getSeverityBadgeKey('low')).toBe('green');
    expect(getSeverityBadgeKey('critical')).toBe('purple');
    expect(getSeverityBadgeKey('unknown')).toBe('gray');
  });

  it('formatRequestType returns label for known types', () => {
    expect(formatRequestType('sar')).toBe('Subject Access Request');
    expect(formatRequestType('erasure')).toBe('Right to Erasure');
  });

  it('formatRequestType returns raw type for unknown', () => {
    expect(formatRequestType('unknown_type')).toBe('unknown_type');
  });
});
