import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMinimumWageRate } from '../../shared/nmw.js';

// Fix "today" so age calculations are deterministic
const FIXED_NOW = new Date('2025-06-15T12:00:00Z');
let dateSpy;

beforeEach(() => {
  dateSpy = vi.spyOn(globalThis, 'Date').mockImplementation(function (...args) {
    if (args.length === 0) return FIXED_NOW;
    return new (Object.getPrototypeOf(FIXED_NOW).constructor)(...args);
  });
  dateSpy.now = Date.now;
  dateSpy.UTC = Date.UTC;
});

afterEach(() => { dateSpy.mockRestore(); });

const config = { nlw_rate: 12.71, nmw_rate_18_20: 10.85, nmw_rate_under_18: 8.00 };

describe('getMinimumWageRate', () => {
  it('returns NLW for staff aged 21+', () => {
    const result = getMinimumWageRate('1990-01-01', config);
    expect(result).toEqual({ rate: 12.71, label: 'NLW' });
  });

  it('returns NLW for staff exactly 21 today', () => {
    // FIXED_NOW = 2025-06-15, so born 2004-06-15 = exactly 21
    const result = getMinimumWageRate('2004-06-15', config);
    expect(result).toEqual({ rate: 12.71, label: 'NLW' });
  });

  it('returns NMW 18-20 for staff aged 20 (turns 21 tomorrow)', () => {
    const result = getMinimumWageRate('2004-06-16', config);
    expect(result).toEqual({ rate: 10.85, label: 'NMW (18-20)' });
  });

  it('returns NMW 18-20 for staff exactly 18', () => {
    const result = getMinimumWageRate('2007-06-15', config);
    expect(result).toEqual({ rate: 10.85, label: 'NMW (18-20)' });
  });

  it('returns NMW U18 for staff aged 17', () => {
    const result = getMinimumWageRate('2008-01-01', config);
    expect(result).toEqual({ rate: 8.00, label: 'NMW (U18)' });
  });

  it('returns NMW U18 for staff turning 18 tomorrow', () => {
    const result = getMinimumWageRate('2007-06-16', config);
    expect(result).toEqual({ rate: 8.00, label: 'NMW (U18)' });
  });

  it('defaults to NLW when no DOB provided', () => {
    const result = getMinimumWageRate(null, config);
    expect(result).toEqual({ rate: 12.71, label: 'NLW' });
  });

  it('defaults to NLW for undefined DOB', () => {
    const result = getMinimumWageRate(undefined, config);
    expect(result).toEqual({ rate: 12.71, label: 'NLW' });
  });

  it('defaults to NLW for invalid DOB', () => {
    const result = getMinimumWageRate('not-a-date', config);
    expect(result).toEqual({ rate: 12.71, label: 'NLW' });
  });

  it('uses fallback rates when config fields missing', () => {
    const sparseConfig = {};
    const result21 = getMinimumWageRate('1990-01-01', sparseConfig);
    expect(result21.rate).toBe(12.21);
    const result19 = getMinimumWageRate('2006-06-16', sparseConfig);
    expect(result19.rate).toBe(10.85);
    const result16 = getMinimumWageRate('2009-01-01', sparseConfig);
    expect(result16.rate).toBe(8.00);
  });

  it('uses config rates when provided', () => {
    const custom = { nlw_rate: 13.00, nmw_rate_18_20: 11.50, nmw_rate_under_18: 9.00 };
    expect(getMinimumWageRate('1990-01-01', custom).rate).toBe(13.00);
    expect(getMinimumWageRate('2006-06-16', custom).rate).toBe(11.50);
    expect(getMinimumWageRate('2009-01-01', custom).rate).toBe(9.00);
  });

  it('handles null config gracefully', () => {
    const result = getMinimumWageRate('1990-01-01', null);
    expect(result).toEqual({ rate: 12.21, label: 'NLW' });
  });
});
