import { describe, expect, it } from 'vitest';
import { evaluateInternalBankTrainingEligibility } from '../../lib/trainingEligibility.js';

describe('internal bank training eligibility', () => {
  it('blocks care staff with missing critical training', () => {
    const result = evaluateInternalBankTrainingEligibility({
      staff: { role: 'Carer', home_config: {} },
      effectiveDate: '2026-05-01',
      recordsByType: new Map([
        ['fire-safety', '2027-01-01'],
        ['moving-handling', '2027-01-01'],
      ]),
    });

    expect(result.status).toBe('blocked');
    expect(result.blockers).toEqual(expect.arrayContaining([
      'Training expired or missing: Safeguarding Adults',
      'Training expired or missing: Medication Awareness',
    ]));
  });

  it('passes care staff with current critical training', () => {
    const result = evaluateInternalBankTrainingEligibility({
      staff: { role: 'Carer', home_config: {} },
      effectiveDate: '2026-05-01',
      recordsByType: new Map([
        ['fire-safety', '2027-01-01'],
        ['moving-handling', '2027-01-01'],
        ['safeguarding-adults', '2027-01-01'],
        ['medication-awareness', '2027-01-01'],
      ]),
    });

    expect(result).toEqual({ status: 'ok', blockers: [] });
  });
});
