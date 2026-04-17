import { describe, it, expect } from 'vitest';
import { getOnboardingBlockingReasons, ONBOARDING_STATUS } from '../onboarding.js';

describe('getOnboardingBlockingReasons', () => {
  it('includes health declaration when it is incomplete', () => {
    const reasons = getOnboardingBlockingReasons('S001', {
      S001: {
        dbs_check: { status: ONBOARDING_STATUS.COMPLETED },
        right_to_work: { status: ONBOARDING_STATUS.COMPLETED },
        references: { status: ONBOARDING_STATUS.COMPLETED },
        identity_check: { status: ONBOARDING_STATUS.COMPLETED },
      },
    });

    expect(reasons).toContain('Health declaration not completed');
  });

  it('requires qualifications for nurses', () => {
    const reasons = getOnboardingBlockingReasons('S001', {
      S001: {
        dbs_check: { status: ONBOARDING_STATUS.COMPLETED },
        right_to_work: { status: ONBOARDING_STATUS.COMPLETED },
        references: { status: ONBOARDING_STATUS.COMPLETED },
        identity_check: { status: ONBOARDING_STATUS.COMPLETED },
        health_declaration: { status: ONBOARDING_STATUS.COMPLETED },
      },
    }, [
      { id: 'S001', role: 'Registered Nurse' },
    ]);

    expect(reasons).toContain('Nursing qualifications not verified');
  });

  it('does not require qualifications for non-nursing roles', () => {
    const reasons = getOnboardingBlockingReasons('S001', {
      S001: {
        dbs_check: { status: ONBOARDING_STATUS.COMPLETED },
        right_to_work: { status: ONBOARDING_STATUS.COMPLETED },
        references: { status: ONBOARDING_STATUS.COMPLETED },
        identity_check: { status: ONBOARDING_STATUS.COMPLETED },
        health_declaration: { status: ONBOARDING_STATUS.COMPLETED },
      },
    }, [
      { id: 'S001', role: 'Senior Carer' },
    ]);

    expect(reasons).not.toContain('Nursing qualifications not verified');
  });
});
