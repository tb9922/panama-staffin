import { describe, test, expect } from 'vitest';
import {
  FUNDING_TYPES, CARE_TYPES, RESIDENT_STATUSES, EXPENSE_CATEGORIES,
  INVOICE_STATUSES, EXPENSE_STATUSES, PAYER_TYPES, PAYMENT_METHODS, LINE_TYPES,
  CHASE_METHODS, SCHEDULE_FREQUENCIES,
  getStatusBadge, getLabel, formatCurrency,
  calculateExpectedMonthlyIncome, calculateOccupancyRate, getAgeingBucket,
  getFinanceAlertsForDashboard,
} from '../finance.js';

// ── Constants completeness ────────────────────────────────────────────────────

describe('constants completeness', () => {
  test('FUNDING_TYPES covers all DB CHECK values', () => {
    const ids = FUNDING_TYPES.map(t => t.id);
    expect(ids).toContain('self_funded');
    expect(ids).toContain('la_funded');
    expect(ids).toContain('chc_funded');
    expect(ids).toContain('split_funded');
    expect(ids).toContain('respite');
    expect(ids).toHaveLength(5);
  });

  test('CARE_TYPES covers all DB CHECK values', () => {
    const ids = CARE_TYPES.map(t => t.id);
    expect(ids).toEqual(expect.arrayContaining(['residential', 'nursing', 'dementia_residential', 'dementia_nursing', 'respite']));
    expect(ids).toHaveLength(5);
  });

  test('EXPENSE_CATEGORIES covers all 16 DB CHECK values', () => {
    const ids = EXPENSE_CATEGORIES.map(c => c.id);
    const expected = [
      'staffing', 'agency', 'food', 'utilities', 'maintenance', 'medical_supplies',
      'cleaning', 'insurance', 'rent', 'rates', 'training', 'equipment',
      'professional_fees', 'transport', 'laundry', 'other',
    ];
    expect(ids).toEqual(expect.arrayContaining(expected));
    expect(ids).toHaveLength(16);
  });

  test('INVOICE_STATUSES covers all DB CHECK values', () => {
    const ids = INVOICE_STATUSES.map(s => s.id);
    expect(ids).toEqual(expect.arrayContaining(['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'credited']));
    expect(ids).toHaveLength(7);
  });

  test('EXPENSE_STATUSES covers all DB CHECK values', () => {
    const ids = EXPENSE_STATUSES.map(s => s.id);
    expect(ids).toEqual(expect.arrayContaining(['pending', 'approved', 'rejected', 'paid', 'void']));
    expect(ids).toHaveLength(5);
  });

  test('PAYER_TYPES covers all DB CHECK values', () => {
    const ids = PAYER_TYPES.map(t => t.id);
    expect(ids).toEqual(expect.arrayContaining(['resident', 'la', 'chc', 'family', 'other']));
    expect(ids).toHaveLength(5);
  });

  test('LINE_TYPES covers all DB CHECK values', () => {
    const ids = LINE_TYPES.map(t => t.id);
    expect(ids).toEqual(expect.arrayContaining(['fee', 'top_up', 'fnc', 'additional', 'adjustment', 'credit']));
    expect(ids).toHaveLength(6);
  });

  test('every status list entry has a badge key', () => {
    for (const s of [...INVOICE_STATUSES, ...EXPENSE_STATUSES, ...RESIDENT_STATUSES]) {
      expect(s.badge).toBeTruthy();
    }
  });
});

// ── getStatusBadge ────────────────────────────────────────────────────────────

describe('getStatusBadge', () => {
  test('returns correct badge for known status', () => {
    expect(getStatusBadge('paid', INVOICE_STATUSES)).toBe('green');
    expect(getStatusBadge('overdue', INVOICE_STATUSES)).toBe('red');
    expect(getStatusBadge('draft', INVOICE_STATUSES)).toBe('gray');
    expect(getStatusBadge('pending', EXPENSE_STATUSES)).toBe('amber');
    expect(getStatusBadge('approved', EXPENSE_STATUSES)).toBe('blue');
  });

  test('returns gray for unknown status', () => {
    expect(getStatusBadge('nonexistent', INVOICE_STATUSES)).toBe('gray');
    expect(getStatusBadge(null, INVOICE_STATUSES)).toBe('gray');
    expect(getStatusBadge(undefined, INVOICE_STATUSES)).toBe('gray');
  });
});

// ── getLabel ──────────────────────────────────────────────────────────────────

describe('getLabel', () => {
  test('returns label for known id', () => {
    expect(getLabel('food', EXPENSE_CATEGORIES)).toBe('Food & Catering');
    expect(getLabel('la', PAYER_TYPES)).toBe('Local Authority');
  });

  test('returns id for unknown entry', () => {
    expect(getLabel('unknown', EXPENSE_CATEGORIES)).toBe('unknown');
  });

  test('returns dash for null/undefined', () => {
    expect(getLabel(null, EXPENSE_CATEGORIES)).toBe('—');
    expect(getLabel(undefined, EXPENSE_CATEGORIES)).toBe('—');
  });
});

// ── formatCurrency ────────────────────────────────────────────────────────────

describe('formatCurrency', () => {
  test('formats positive amounts', () => {
    expect(formatCurrency(1234.56)).toBe('£1,234.56');
    expect(formatCurrency(0)).toBe('£0.00');
    expect(formatCurrency(100)).toBe('£100.00');
  });

  test('formats negative amounts with sign', () => {
    expect(formatCurrency(-500)).toBe('-£500.00');
  });

  test('formats large numbers with commas', () => {
    expect(formatCurrency(1000000)).toBe('£1,000,000.00');
  });

  test('handles null/undefined/NaN/empty string', () => {
    expect(formatCurrency(null)).toBe('—');
    expect(formatCurrency(undefined)).toBe('—');
    expect(formatCurrency(NaN)).toBe('—');
    expect(formatCurrency('')).toBe('—');
  });

  test('handles string numbers', () => {
    expect(formatCurrency('1234.50')).toBe('£1,234.50');
  });
});

// ── calculateExpectedMonthlyIncome ────────────────────────────────────────────

describe('calculateExpectedMonthlyIncome', () => {
  test('calculates from active residents weekly fees', () => {
    const residents = [
      { status: 'active', weekly_fee: 1000 },
      { status: 'active', weekly_fee: 800 },
    ];
    const result = calculateExpectedMonthlyIncome(residents);
    expect(result).toBeCloseTo(1800 * 4.33, 2);
  });

  test('excludes discharged residents', () => {
    const residents = [
      { status: 'active', weekly_fee: 1000 },
      { status: 'discharged', weekly_fee: 800 },
    ];
    const result = calculateExpectedMonthlyIncome(residents);
    expect(result).toBeCloseTo(1000 * 4.33, 2);
  });

  test('returns 0 for empty list', () => {
    expect(calculateExpectedMonthlyIncome([])).toBe(0);
    expect(calculateExpectedMonthlyIncome(null)).toBe(0);
    expect(calculateExpectedMonthlyIncome(undefined)).toBe(0);
  });

  test('handles null/zero weekly fees', () => {
    const residents = [
      { status: 'active', weekly_fee: null },
      { status: 'active', weekly_fee: 0 },
      { status: 'active', weekly_fee: 500 },
    ];
    const result = calculateExpectedMonthlyIncome(residents);
    expect(result).toBeCloseTo(500 * 4.33, 2);
  });
});

// ── calculateOccupancyRate ────────────────────────────────────────────────────

describe('calculateOccupancyRate', () => {
  test('calculates correct percentage', () => {
    expect(calculateOccupancyRate(38, 40)).toBeCloseTo(95, 1);
    expect(calculateOccupancyRate(40, 40)).toBe(100);
    expect(calculateOccupancyRate(20, 40)).toBe(50);
  });

  test('returns 0 for zero beds', () => {
    expect(calculateOccupancyRate(0, 0)).toBe(0);
    expect(calculateOccupancyRate(5, 0)).toBe(0);
  });

  test('returns 0 for null/undefined beds', () => {
    expect(calculateOccupancyRate(5, null)).toBe(0);
    expect(calculateOccupancyRate(5, undefined)).toBe(0);
  });
});

// ── getAgeingBucket ───────────────────────────────────────────────────────────

describe('getAgeingBucket', () => {
  const today = '2026-02-26';

  test('current: due today or in the future', () => {
    expect(getAgeingBucket('2026-02-26', today)).toBe('current');
    expect(getAgeingBucket('2026-03-15', today)).toBe('current');
  });

  test('days_1_30: overdue by 1-30 days', () => {
    expect(getAgeingBucket('2026-02-25', today)).toBe('days_1_30');
    expect(getAgeingBucket('2026-01-27', today)).toBe('days_1_30');
  });

  test('days_31_60: overdue by 31-60 days', () => {
    expect(getAgeingBucket('2026-01-26', today)).toBe('days_31_60');
    expect(getAgeingBucket('2025-12-28', today)).toBe('days_31_60');
  });

  test('days_61_90: overdue by 61-90 days', () => {
    expect(getAgeingBucket('2025-12-27', today)).toBe('days_61_90');
    expect(getAgeingBucket('2025-11-28', today)).toBe('days_61_90');
  });

  test('days_90_plus: overdue by more than 90 days', () => {
    expect(getAgeingBucket('2025-11-27', today)).toBe('days_90_plus');
    expect(getAgeingBucket('2025-01-01', today)).toBe('days_90_plus');
  });

  test('returns current for null due date', () => {
    expect(getAgeingBucket(null, today)).toBe('current');
    expect(getAgeingBucket(undefined, today)).toBe('current');
  });
});

// ── CHASE_METHODS ────────────────────────────────────────────────────────────

describe('CHASE_METHODS', () => {
  test('covers all DB CHECK values', () => {
    const ids = CHASE_METHODS.map(m => m.id);
    expect(ids).toEqual(expect.arrayContaining(['email', 'phone', 'letter', 'in_person', 'other']));
    expect(ids).toHaveLength(5);
  });

  test('every method has a label', () => {
    CHASE_METHODS.forEach(m => {
      expect(m.label).toBeTruthy();
    });
  });
});

// ── SCHEDULE_FREQUENCIES ─────────────────────────────────────────────────────

describe('SCHEDULE_FREQUENCIES', () => {
  test('covers all DB CHECK values', () => {
    const ids = SCHEDULE_FREQUENCIES.map(f => f.id);
    expect(ids).toEqual(expect.arrayContaining(['weekly', 'monthly', 'quarterly', 'annually']));
    expect(ids).toHaveLength(4);
  });

  test('every frequency has a label', () => {
    SCHEDULE_FREQUENCIES.forEach(f => {
      expect(f.label).toBeTruthy();
    });
  });
});

// ── getFinanceAlertsForDashboard ─────────────────────────────────────────────

describe('getFinanceAlertsForDashboard', () => {
  test('maps finance alert shape to dashboard alert shape', () => {
    const alerts = [
      { type: 'error', message: '2 invoices 90+ days overdue' },
      { type: 'warning', message: '3 invoices overdue' },
      { type: 'info', message: '2 expenses pending' },
    ];
    const result = getFinanceAlertsForDashboard(alerts);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: 'error', msg: 'Finance: 2 invoices 90+ days overdue', link: null });
    expect(result[1]).toEqual({ type: 'warning', msg: 'Finance: 3 invoices overdue', link: null });
    expect(result[2]).toEqual({ type: 'warning', msg: 'Finance: 2 expenses pending', link: null });
  });

  test('passes through link when present', () => {
    const alerts = [
      { type: 'error', message: 'Overdue invoices', link: '/finance/receivables' },
      { type: 'warning', message: 'No link here' },
    ];
    const result = getFinanceAlertsForDashboard(alerts);
    expect(result[0].link).toBe('/finance/receivables');
    expect(result[1].link).toBeNull();
  });

  test('returns empty array for null/undefined', () => {
    expect(getFinanceAlertsForDashboard(null)).toEqual([]);
    expect(getFinanceAlertsForDashboard(undefined)).toEqual([]);
  });

  test('returns empty array for empty input', () => {
    expect(getFinanceAlertsForDashboard([])).toEqual([]);
  });
});
