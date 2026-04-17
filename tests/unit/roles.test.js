import { describe, it, expect } from 'vitest';
import {
  MODULES, ROLES, ROLE_IDS,
  hasModuleAccess, getVisibleModules, canWriteModule,
  canAssignRole, getRoleLabel, isOwnDataOnly,
} from '../../shared/roles.js';
import {
  canAccessEvidenceHub,
  getReadableEvidenceSources,
  getWritableEvidenceSources,
} from '../../shared/evidenceHub.js';

describe('shared/roles.js', () => {
  describe('MODULES', () => {
    it('has exactly 10 modules', () => {
      expect(MODULES).toHaveLength(10);
    });

    it('includes all expected modules', () => {
      const expected = ['scheduling', 'staff', 'hr', 'compliance', 'governance',
        'finance', 'payroll', 'gdpr', 'reports', 'config'];
      expect(MODULES).toEqual(expected);
    });
  });

  describe('ROLES', () => {
    it('has exactly 8 predefined roles', () => {
      expect(ROLE_IDS).toHaveLength(8);
    });

    it('every role defines all 10 modules', () => {
      for (const [roleId, role] of Object.entries(ROLES)) {
        for (const mod of MODULES) {
          expect(role.modules[mod], `${roleId} missing module ${mod}`).toBeDefined();
        }
      }
    });

    it('every module access level is valid', () => {
      const validLevels = new Set(['none', 'read', 'write', 'own']);
      for (const [roleId, role] of Object.entries(ROLES)) {
        for (const [mod, level] of Object.entries(role.modules)) {
          expect(validLevels.has(level), `${roleId}.${mod} = ${level}`).toBe(true);
        }
      }
    });

    it('only home_manager has canManageUsers', () => {
      for (const [roleId, role] of Object.entries(ROLES)) {
        if (roleId === 'home_manager') {
          expect(role.canManageUsers).toBe(true);
        } else {
          expect(role.canManageUsers, `${roleId} should not manage users`).toBe(false);
        }
      }
    });

    it('home_manager has write access to all modules', () => {
      for (const mod of MODULES) {
        expect(ROLES.home_manager.modules[mod]).toBe('write');
      }
    });

    it('staff_member only has own access to scheduling and payroll', () => {
      const sm = ROLES.staff_member.modules;
      expect(sm.scheduling).toBe('own');
      expect(sm.payroll).toBe('own');
      // All others should be none
      for (const mod of MODULES) {
        if (mod !== 'scheduling' && mod !== 'payroll') {
          expect(sm[mod], `staff_member.${mod}`).toBe('none');
        }
      }
    });

    it('every role has a label', () => {
      for (const [roleId, role] of Object.entries(ROLES)) {
        expect(typeof role.label, `${roleId} label`).toBe('string');
        expect(role.label.length).toBeGreaterThan(0);
      }
    });
  });

  describe('hasModuleAccess', () => {
    it('returns false for unknown role', () => {
      expect(hasModuleAccess('nonexistent', 'scheduling', 'read')).toBe(false);
    });

    it('returns false for none access', () => {
      expect(hasModuleAccess('viewer', 'hr', 'read')).toBe(false);
    });

    it('read check: write implies read', () => {
      expect(hasModuleAccess('home_manager', 'scheduling', 'read')).toBe(true);
    });

    it('read check: read satisfies read', () => {
      expect(hasModuleAccess('viewer', 'scheduling', 'read')).toBe(true);
    });

    it('read check: own satisfies read (staff_member can see own scheduling data)', () => {
      expect(hasModuleAccess('staff_member', 'scheduling', 'read')).toBe(true);
    });

    it('read check can explicitly exclude own-data access', () => {
      expect(hasModuleAccess('staff_member', 'scheduling', 'read', { includeOwn: false })).toBe(false);
      expect(hasModuleAccess('viewer', 'scheduling', 'read', { includeOwn: false })).toBe(true);
    });

    it('write check: write satisfies write', () => {
      expect(hasModuleAccess('home_manager', 'payroll', 'write')).toBe(true);
    });

    it('write check: read does NOT satisfy write', () => {
      expect(hasModuleAccess('viewer', 'scheduling', 'write')).toBe(false);
    });

    it('write check: own does NOT satisfy write', () => {
      expect(hasModuleAccess('staff_member', 'scheduling', 'write')).toBe(false);
    });

    it('own check: own satisfies own', () => {
      expect(hasModuleAccess('staff_member', 'scheduling', 'own')).toBe(true);
    });

    it('own check: read does NOT satisfy own', () => {
      expect(hasModuleAccess('viewer', 'scheduling', 'own')).toBe(false);
    });

    it('own check: write does NOT satisfy own', () => {
      expect(hasModuleAccess('home_manager', 'scheduling', 'own')).toBe(false);
    });

    it('defaults to read level', () => {
      expect(hasModuleAccess('viewer', 'scheduling')).toBe(true);
      expect(hasModuleAccess('viewer', 'hr')).toBe(false);
    });

    it('returns false for invalid level', () => {
      expect(hasModuleAccess('home_manager', 'scheduling', 'invalid')).toBe(false);
    });

    // Role-specific spot checks
    it('deputy_manager can read hr but not write', () => {
      expect(hasModuleAccess('deputy_manager', 'hr', 'read')).toBe(true);
      expect(hasModuleAccess('deputy_manager', 'hr', 'write')).toBe(false);
    });

    it('training_lead can write staff and compliance', () => {
      expect(hasModuleAccess('training_lead', 'staff', 'write')).toBe(true);
      expect(hasModuleAccess('training_lead', 'compliance', 'write')).toBe(true);
    });

    it('finance_officer can write finance and payroll only', () => {
      expect(hasModuleAccess('finance_officer', 'finance', 'write')).toBe(true);
      expect(hasModuleAccess('finance_officer', 'payroll', 'write')).toBe(true);
      expect(hasModuleAccess('finance_officer', 'staff', 'write')).toBe(false);
      expect(hasModuleAccess('finance_officer', 'hr', 'read')).toBe(false);
    });

    it('hr_officer can write hr and staff', () => {
      expect(hasModuleAccess('hr_officer', 'hr', 'write')).toBe(true);
      expect(hasModuleAccess('hr_officer', 'staff', 'write')).toBe(true);
      expect(hasModuleAccess('hr_officer', 'finance', 'read')).toBe(true);
    });

    it('shift_coordinator can write scheduling only', () => {
      expect(hasModuleAccess('shift_coordinator', 'scheduling', 'write')).toBe(true);
      expect(hasModuleAccess('shift_coordinator', 'staff', 'write')).toBe(false);
      expect(hasModuleAccess('shift_coordinator', 'staff', 'read')).toBe(true);
    });
  });

  describe('getVisibleModules', () => {
    it('returns empty for unknown role', () => {
      expect(getVisibleModules('nonexistent')).toEqual([]);
    });

    it('home_manager sees all 10 modules', () => {
      expect(getVisibleModules('home_manager')).toHaveLength(10);
    });

    it('viewer sees scheduling, staff, reports', () => {
      const visible = getVisibleModules('viewer');
      expect(visible).toContain('scheduling');
      expect(visible).toContain('staff');
      expect(visible).toContain('reports');
      expect(visible).not.toContain('hr');
      expect(visible).not.toContain('finance');
    });

    it('staff_member sees scheduling and payroll only', () => {
      const visible = getVisibleModules('staff_member');
      expect(visible).toEqual(['scheduling', 'payroll']);
    });

    it('finance_officer sees scheduling, finance, payroll, reports', () => {
      const visible = getVisibleModules('finance_officer');
      expect(visible).toContain('scheduling');
      expect(visible).toContain('finance');
      expect(visible).toContain('payroll');
      expect(visible).toContain('reports');
      expect(visible).not.toContain('hr');
    });
  });

  describe('canWriteModule', () => {
    it('returns true when role has write access', () => {
      expect(canWriteModule('home_manager', 'hr')).toBe(true);
    });

    it('returns false when role has only read access', () => {
      expect(canWriteModule('viewer', 'scheduling')).toBe(false);
    });

    it('returns false when role has own access', () => {
      expect(canWriteModule('staff_member', 'scheduling')).toBe(false);
    });
  });

  describe('canAssignRole', () => {
    it('home_manager can assign all roles except home_manager', () => {
      for (const targetRole of ROLE_IDS) {
        if (targetRole === 'home_manager') {
          expect(canAssignRole('home_manager', targetRole)).toBe(false);
        } else {
          expect(canAssignRole('home_manager', targetRole),
            `HM should assign ${targetRole}`).toBe(true);
        }
      }
    });

    it('non-managers cannot assign any role', () => {
      const nonManagers = ROLE_IDS.filter(r => r !== 'home_manager');
      for (const assigner of nonManagers) {
        for (const target of ROLE_IDS) {
          expect(canAssignRole(assigner, target),
            `${assigner} should not assign ${target}`).toBe(false);
        }
      }
    });

    it('returns false for unknown assigner', () => {
      expect(canAssignRole('nonexistent', 'viewer')).toBe(false);
    });
  });

  describe('getRoleLabel', () => {
    it('returns label for known roles', () => {
      expect(getRoleLabel('home_manager')).toBe('Home Manager');
      expect(getRoleLabel('staff_member')).toBe('Staff Member');
      expect(getRoleLabel('deputy_manager')).toBe('Deputy Manager');
    });

    it('returns roleId as fallback for unknown roles', () => {
      expect(getRoleLabel('nonexistent')).toBe('nonexistent');
    });
  });

  describe('isOwnDataOnly', () => {
    it('returns true for staff_member on scheduling', () => {
      expect(isOwnDataOnly('staff_member', 'scheduling')).toBe(true);
    });

    it('returns true for staff_member on payroll', () => {
      expect(isOwnDataOnly('staff_member', 'payroll')).toBe(true);
    });

    it('returns false for home_manager (write, not own)', () => {
      expect(isOwnDataOnly('home_manager', 'scheduling')).toBe(false);
    });

    it('returns false for viewer (read, not own)', () => {
      expect(isOwnDataOnly('viewer', 'scheduling')).toBe(false);
    });

    it('returns false for unknown role', () => {
      expect(isOwnDataOnly('nonexistent', 'scheduling')).toBe(false);
    });

    it('returns false for staff_member on modules with none access', () => {
      expect(isOwnDataOnly('staff_member', 'hr')).toBe(false);
    });
  });

  describe('evidence hub access helpers', () => {
    it('home manager can access all evidence sources', () => {
      expect(canAccessEvidenceHub('home_manager')).toBe(true);
      expect(getReadableEvidenceSources('home_manager').map((source) => source.id)).toEqual([
        'hr',
        'cqc_evidence',
        'onboarding',
        'training',
        'record',
      ]);
    });

    it('hr officer can access HR and permitted operational evidence', () => {
      expect(canAccessEvidenceHub('hr_officer')).toBe(true);
      expect(getReadableEvidenceSources('hr_officer').map((source) => source.id)).toEqual(['hr', 'record']);
      expect(getWritableEvidenceSources('hr_officer').map((source) => source.id)).toEqual(['hr', 'record']);
    });

    it('finance officer can access record evidence only', () => {
      expect(canAccessEvidenceHub('finance_officer')).toBe(true);
      expect(getReadableEvidenceSources('finance_officer').map((source) => source.id)).toEqual(['record']);
      expect(getWritableEvidenceSources('finance_officer').map((source) => source.id)).toEqual(['record']);
    });

    it('viewer can access only record evidence backed by staff read access', () => {
      expect(canAccessEvidenceHub('viewer')).toBe(true);
      expect(getReadableEvidenceSources('viewer').map((source) => source.id)).toEqual(['record']);
      expect(getWritableEvidenceSources('viewer')).toEqual([]);
    });
  });
});
