import { describe, expect, it } from 'vitest';
import {
  canManageSensitiveStaffFields,
  listChangedSensitiveStaffFields,
  redactStaffForBroadReader,
  visibleOnboardingSectionsForRole,
} from '../../shared/staffPolicy.js';

describe('staffPolicy', () => {
  it('limits sensitive staff management to home management, HR, or platform admin', () => {
    expect(canManageSensitiveStaffFields('home_manager')).toBe(true);
    expect(canManageSensitiveStaffFields('deputy_manager')).toBe(true);
    expect(canManageSensitiveStaffFields('hr_officer')).toBe(true);
    expect(canManageSensitiveStaffFields('training_lead')).toBe(false);
    expect(canManageSensitiveStaffFields(null, { isPlatformAdmin: true })).toBe(true);
  });

  it('flags only changed sensitive staff fields on partial updates', () => {
    const existing = {
      name: 'Alice Smith',
      hourly_rate: 14.5,
      contract_hours: 36,
      team: 'Day A',
    };

    expect(listChangedSensitiveStaffFields({
      name: 'Alice A. Smith',
      hourly_rate: 14.5,
      contract_hours: 36,
      team: 'Day B',
    }, existing)).toEqual([]);

    expect(listChangedSensitiveStaffFields({
      hourly_rate: 15,
      team: 'Day B',
    }, existing)).toEqual(['hourly_rate']);
  });

  it('returns a narrow staff DTO for broad readers without losing versions', () => {
    const [staff] = redactStaffForBroadReader([{
      id: 'S001',
      name: 'Alice Smith',
      role: 'Carer',
      team: 'Day A',
      pref: 'EL',
      skill: 1,
      active: true,
      start_date: '2026-01-01',
      leaving_date: null,
      version: 7,
      hourly_rate: 14.5,
      ni_number: 'AB123456C',
      contract_hours: 36,
    }]);

    expect(staff).toMatchObject({ id: 'S001', name: 'Alice Smith', version: 7 });
    expect(staff).not.toHaveProperty('hourly_rate');
    expect(staff).not.toHaveProperty('ni_number');
    expect(staff).not.toHaveProperty('contract_hours');
    expect(staff).not.toHaveProperty('leaving_date');
  });

  it('hides sensitive onboarding sections from non-HR compliance roles', () => {
    const sections = [
      { id: 'dbs_check' },
      { id: 'qualifications' },
      { id: 'contract' },
      { id: 'day1_induction' },
    ];

    expect(visibleOnboardingSectionsForRole(sections, 'training_lead').map(s => s.id))
      .toEqual(['qualifications', 'day1_induction']);
    expect(visibleOnboardingSectionsForRole(sections, 'hr_officer').map(s => s.id))
      .toEqual(['dbs_check', 'qualifications', 'contract', 'day1_induction']);
  });
});
