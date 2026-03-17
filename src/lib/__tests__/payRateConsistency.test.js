import { describe, it, expect } from 'vitest';
import { checkConsistency } from '../../../shared/payRateConsistency.js';

const BASE_CONFIG = {
  ot_premium: 2,
  bh_premium_multiplier: 1.5,
};

function makeRule(overrides) {
  return {
    id: 1,
    applies_to: 'on_call',
    rate_type: 'fixed_hourly',
    amount: 2,
    effective_to: null,
    ...overrides,
  };
}

describe('checkConsistency', () => {
  it('returns consistent when config and rules match exactly', () => {
    const rules = [
      makeRule({ applies_to: 'on_call', rate_type: 'fixed_hourly', amount: 2 }),
      makeRule({ applies_to: 'bank_holiday', rate_type: 'percentage', amount: 50 }),
    ];
    const result = checkConsistency(BASE_CONFIG, rules);
    expect(result.consistent).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('detects OT premium mismatch', () => {
    const rules = [
      makeRule({ applies_to: 'on_call', rate_type: 'fixed_hourly', amount: 3 }),
    ];
    const result = checkConsistency(BASE_CONFIG, rules);
    expect(result.consistent).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].field).toBe('ot_premium');
    expect(result.warnings[0].configValue).toBe(2);
    expect(result.warnings[0].rulesValue).toBe(3);
  });

  it('detects BH premium mismatch', () => {
    const rules = [
      makeRule({ applies_to: 'on_call', rate_type: 'fixed_hourly', amount: 2 }),
      makeRule({ applies_to: 'bank_holiday', rate_type: 'percentage', amount: 75 }),
    ];
    const result = checkConsistency(BASE_CONFIG, rules);
    expect(result.consistent).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].field).toBe('bh_premium_multiplier');
  });

  it('detects both OT and BH mismatch simultaneously', () => {
    const rules = [
      makeRule({ applies_to: 'on_call', rate_type: 'fixed_hourly', amount: 5 }),
      makeRule({ applies_to: 'bank_holiday', rate_type: 'percentage', amount: 100 }),
    ];
    const result = checkConsistency(BASE_CONFIG, rules);
    expect(result.consistent).toBe(false);
    expect(result.warnings).toHaveLength(2);
  });

  it('warns on structural mismatch — multiple stacked on_call rules', () => {
    const rules = [
      makeRule({ id: 1, applies_to: 'on_call', rate_type: 'fixed_hourly', amount: 1 }),
      makeRule({ id: 2, applies_to: 'on_call', rate_type: 'fixed_hourly', amount: 1 }),
    ];
    const result = checkConsistency(BASE_CONFIG, rules);
    expect(result.consistent).toBe(false);
    expect(result.warnings[0].field).toBe('ot_premium');
    expect(result.warnings[0].rulesValue).toBeNull();
    expect(result.warnings[0].message).toContain('2 active');
  });

  it('warns on structural mismatch — non-fixed_hourly on_call rule', () => {
    const rules = [
      makeRule({ applies_to: 'on_call', rate_type: 'percentage', amount: 15 }),
    ];
    const result = checkConsistency(BASE_CONFIG, rules);
    expect(result.consistent).toBe(false);
    expect(result.warnings[0].message).toContain('percentage');
  });

  it('warns on structural mismatch — non-percentage bank_holiday rule', () => {
    const rules = [
      makeRule({ applies_to: 'bank_holiday', rate_type: 'flat_per_shift', amount: 50 }),
    ];
    const result = checkConsistency(BASE_CONFIG, rules);
    expect(result.consistent).toBe(false);
    expect(result.warnings[0].field).toBe('bh_premium_multiplier');
    expect(result.warnings[0].message).toContain('flat_per_shift');
  });

  it('returns consistent when no on_call or bank_holiday rules exist (not yet seeded)', () => {
    const rules = [
      makeRule({ applies_to: 'night', rate_type: 'percentage', amount: 15 }),
    ];
    const result = checkConsistency(BASE_CONFIG, rules);
    expect(result.consistent).toBe(true);
  });

  it('returns consistent when no rules at all', () => {
    const result = checkConsistency(BASE_CONFIG, []);
    expect(result.consistent).toBe(true);
  });

  it('handles null config gracefully', () => {
    const result = checkConsistency(null, [makeRule()]);
    expect(result.consistent).toBe(true);
  });

  it('handles null rules gracefully', () => {
    const result = checkConsistency(BASE_CONFIG, null);
    expect(result.consistent).toBe(true);
  });

  it('ignores deactivated rules (effective_to set)', () => {
    const rules = [
      makeRule({ applies_to: 'on_call', rate_type: 'fixed_hourly', amount: 99, effective_to: '2025-01-01' }),
    ];
    const result = checkConsistency(BASE_CONFIG, rules);
    // Deactivated rule should be filtered out — no active on_call rules, so no warning
    expect(result.consistent).toBe(true);
  });
});
