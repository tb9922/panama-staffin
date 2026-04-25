// Regression tests for P0-RT1 type-mismatch fix.
//
// The original fix attempt passed the result of getHomeRole (which is an object
// { role_id, staff_id }) directly to hasModuleAccess (which expects a string
// roleId). That resulted in every non-platform-admin returning 403.
//
// These tests exercise the role matrix directly against hasModuleAccess with
// the correct `assignment.role_id` unwrap. They lock the contract between
// `getHomeRole` (repo) and `hasModuleAccess` (role matrix) so any future caller
// that forgets to unwrap will fail unit tests instead of only failing in
// integration against a real DB.

import { describe, it, expect } from 'vitest';
import { hasModuleAccess } from '../../shared/roles.js';

describe('Audit route authorisation — role-matrix contract (P0-RT1 regression)', () => {
  it('hasModuleAccess expects a string roleId, not a role-assignment object', () => {
    // If someone passes the full assignment object from getHomeRole (which is
    // { role_id, staff_id }), hasModuleAccess coerces to "[object Object]"
    // and unconditionally returns false. This is the bug the original P0-RT1
    // commit shipped.
    const assignment = { role_id: 'home_manager', staff_id: null };
    expect(hasModuleAccess(assignment, 'config', 'read')).toBe(false);

    // Passing the unwrapped string works as expected.
    expect(hasModuleAccess(assignment.role_id, 'config', 'read')).toBe(true);
  });

  describe('config:read gate for audit log access', () => {
    it('home_manager can read audit log (config:write implies read)', () => {
      expect(hasModuleAccess('home_manager', 'config', 'read')).toBe(true);
    });

    it('deputy_manager can read audit log (config:read)', () => {
      expect(hasModuleAccess('deputy_manager', 'config', 'read')).toBe(true);
    });

    it('viewer CANNOT read audit log (config:none)', () => {
      expect(hasModuleAccess('viewer', 'config', 'read')).toBe(false);
    });

    it('staff_member CANNOT read audit log', () => {
      expect(hasModuleAccess('staff_member', 'config', 'read')).toBe(false);
    });

    it('shift_coordinator CANNOT read audit log (config:none)', () => {
      expect(hasModuleAccess('shift_coordinator', 'config', 'read')).toBe(false);
    });

    it('finance_officer CANNOT read audit log (config:none)', () => {
      expect(hasModuleAccess('finance_officer', 'config', 'read')).toBe(false);
    });

    it('hr_officer CANNOT read audit log (config:none)', () => {
      expect(hasModuleAccess('hr_officer', 'config', 'read')).toBe(false);
    });

    it('training_lead CANNOT read audit log (config:none)', () => {
      expect(hasModuleAccess('training_lead', 'config', 'read')).toBe(false);
    });
  });

  describe('gdpr:read gate for access log', () => {
    it('home_manager can read access log', () => {
      expect(hasModuleAccess('home_manager', 'gdpr', 'read')).toBe(true);
    });

    it('deputy_manager can read access log (gdpr:read for SAR handling)', () => {
      expect(hasModuleAccess('deputy_manager', 'gdpr', 'read')).toBe(true);
    });

    it('hr_officer can read access log (gdpr:read for SAR + erasure coordination)', () => {
      expect(hasModuleAccess('hr_officer', 'gdpr', 'read')).toBe(true);
    });

    it('viewer CANNOT read access log', () => {
      expect(hasModuleAccess('viewer', 'gdpr', 'read')).toBe(false);
    });

    it('finance_officer CANNOT read access log', () => {
      expect(hasModuleAccess('finance_officer', 'gdpr', 'read')).toBe(false);
    });
  });
});
