import { describe, it, expect } from 'vitest';
import { flexWorkingBodySchema, ohReferralBodySchema, rtwInterviewBodySchema } from '../../routes/hr/schemas.js';

describe('HR schema blank-select handling', () => {
  it('accepts blank RTW select values and explicit none trigger level', () => {
    const blankResult = rtwInterviewBodySchema.safeParse({
      staff_id: 'S001',
      absence_start_date: '2026-04-01',
      rtw_date: '2026-04-02',
      conducted_by: 'Manager A',
      fit_note_type: '',
      trigger_reached: '',
      action_taken: '',
    });
    expect(blankResult.success).toBe(true);
    expect(blankResult.data.fit_note_type).toBeNull();
    expect(blankResult.data.trigger_reached).toBeNull();
    expect(blankResult.data.action_taken).toBeNull();

    const noneResult = rtwInterviewBodySchema.safeParse({
      staff_id: 'S001',
      absence_start_date: '2026-04-01',
      rtw_date: '2026-04-02',
      conducted_by: 'Manager A',
      trigger_reached: 'none',
      action_taken: 'none',
    });
    expect(noneResult.success).toBe(true);
    expect(noneResult.data.trigger_reached).toBe('none');
    expect(noneResult.data.action_taken).toBe('none');
  });

  it('accepts blank OH select values from the form state', () => {
    const result = ohReferralBodySchema.safeParse({
      staff_id: 'S001',
      referral_date: '2026-04-01',
      referred_by: 'Manager A',
      reason: 'Back pain review',
      fit_for_role: '',
      disability_likely: '',
      consent_method: '',
      questions_for_oh: '',
    });
    expect(result.success).toBe(true);
    expect(result.data.fit_for_role).toBeNull();
    expect(result.data.disability_likely).toBeNull();
    expect(result.data.consent_method).toBeNull();
    expect(result.data.questions_for_oh).toBe('');
  });

  it('rejects invalid flexible working decision values and keeps blank selects nullable', () => {
    const validBlankResult = flexWorkingBodySchema.safeParse({
      staff_id: 'S001',
      request_date: '2026-04-01',
      requested_change: 'Compressed hours',
      decision_deadline: '2026-06-01',
      decision: '',
      appeal_outcome: '',
    });
    expect(validBlankResult.success).toBe(true);
    expect(validBlankResult.data.decision).toBeNull();
    expect(validBlankResult.data.appeal_outcome).toBeNull();

    const invalidResult = flexWorkingBodySchema.safeParse({
      staff_id: 'S001',
      request_date: '2026-04-01',
      requested_change: 'Compressed hours',
      decision_deadline: '2026-06-01',
      decision: 'pending',
      appeal_outcome: 'partially_upheld',
    });
    expect(invalidResult.success).toBe(false);
  });
});
