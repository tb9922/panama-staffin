import { describe, expect, it } from 'vitest';
import { getDolsMaxExpiryDate, validateDolsAuthorisationWindow } from '../../shared/dolsValidation.js';

describe('dolsValidation', () => {
  it('calculates the 12-month max expiry date', () => {
    expect(getDolsMaxExpiryDate('2026-03-25')).toBe('2027-03-25');
  });

  it('clamps leap-day authorisations to the end of February next year', () => {
    expect(getDolsMaxExpiryDate('2024-02-29')).toBe('2025-02-28');
  });

  it('rejects expiry dates beyond 12 months', () => {
    expect(validateDolsAuthorisationWindow({
      authorised: true,
      authorisation_date: '2026-03-25',
      expiry_date: '2027-03-26',
    })).toContain('12 months');
  });

  it('rejects expiry dates before the authorisation date', () => {
    expect(validateDolsAuthorisationWindow({
      authorised: true,
      authorisation_date: '2026-03-25',
      expiry_date: '2026-03-24',
    })).toContain('earlier');
  });

  it('allows exactly 12 months', () => {
    expect(validateDolsAuthorisationWindow({
      authorised: true,
      authorisation_date: '2026-03-25',
      expiry_date: '2027-03-25',
    })).toBeNull();
  });
});
