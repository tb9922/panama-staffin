import { describe, expect, it } from 'vitest';
import { hasModuleAccess } from '../../shared/roles.js';

describe('audit route role gates', () => {
  it('requires callers to unwrap getHomeRole assignments before hasModuleAccess', () => {
    const assignment = { role_id: 'home_manager', staff_id: null };

    expect(hasModuleAccess(assignment, 'config', 'read')).toBe(false);
    expect(hasModuleAccess(assignment.role_id, 'config', 'read')).toBe(true);
  });

  it('uses config:read for home audit-log access', () => {
    expect(hasModuleAccess('home_manager', 'config', 'read')).toBe(true);
    expect(hasModuleAccess('deputy_manager', 'config', 'read')).toBe(true);
    expect(hasModuleAccess('viewer', 'config', 'read')).toBe(false);
    expect(hasModuleAccess('shift_coordinator', 'config', 'read')).toBe(false);
    expect(hasModuleAccess('finance_officer', 'config', 'read')).toBe(false);
    expect(hasModuleAccess('hr_officer', 'config', 'read')).toBe(false);
  });

  it('uses gdpr:read for GDPR access-log access', () => {
    expect(hasModuleAccess('home_manager', 'gdpr', 'read')).toBe(true);
    expect(hasModuleAccess('deputy_manager', 'gdpr', 'read')).toBe(true);
    expect(hasModuleAccess('hr_officer', 'gdpr', 'read')).toBe(true);
    expect(hasModuleAccess('viewer', 'gdpr', 'read')).toBe(false);
    expect(hasModuleAccess('finance_officer', 'gdpr', 'read')).toBe(false);
  });
});
