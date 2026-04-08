import { describe, expect, it } from 'vitest';
import { ohReferralBodySchema, rtwInterviewBodySchema } from '../../routes/hr/schemas.js';

describe('hr schema blank-select handling', () => {
  it('accepts blank RTW select values and explicit none', () => {
    const parsed = rtwInterviewBodySchema.parse({
      staff_id: 'S001',
      absence_start_date: '2026-04-01',
      rtw_date: '2026-04-08',
      conducted_by: 'Manager A',
      fit_note_type: '',
      trigger_reached: 'none',
      action_taken: '',
    });

    expect(parsed.fit_note_type).toBeNull();
    expect(parsed.trigger_reached).toBe('none');
    expect(parsed.action_taken).toBeNull();
  });

  it('accepts blank OH select values from form state', () => {
    const parsed = ohReferralBodySchema.parse({
      staff_id: 'S001',
      referral_date: '2026-04-08',
      referred_by: 'Manager A',
      reason: 'Back pain',
      fit_for_role: '',
      disability_likely: '',
    });

    expect(parsed.fit_for_role).toBeNull();
    expect(parsed.disability_likely).toBeNull();
  });
});
