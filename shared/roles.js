// Per-Home Role-Based Access Control — Module-level permissions
// Shared between server and client (same pattern as shared/rotation.js)

/**
 * Permission modules — each maps to a sidebar section and its backend routes.
 * Access levels: 'none' | 'read' | 'write' | 'own' (own = self-data only, staff_member role)
 */
export const MODULES = [
  'scheduling', 'staff', 'hr', 'compliance', 'governance',
  'finance', 'payroll', 'gdpr', 'reports', 'config',
];

/**
 * Predefined roles. role_id strings match the keys here.
 * Stored in code (not DB) to prevent version drift between deployments.
 */
export const ROLES = {
  home_manager: {
    label: 'Home Manager',
    canManageUsers: true,
    modules: { scheduling: 'write', staff: 'write', hr: 'write', compliance: 'write', governance: 'write', finance: 'write', payroll: 'write', gdpr: 'write', reports: 'write', config: 'write' },
  },
  deputy_manager: {
    label: 'Deputy Manager',
    canManageUsers: false,
    modules: { scheduling: 'write', staff: 'write', hr: 'read', compliance: 'write', governance: 'write', finance: 'read', payroll: 'read', gdpr: 'read', reports: 'write', config: 'read' },
  },
  training_lead: {
    label: 'Training Lead',
    canManageUsers: false,
    modules: { scheduling: 'read', staff: 'write', hr: 'none', compliance: 'write', governance: 'read', finance: 'none', payroll: 'none', gdpr: 'none', reports: 'read', config: 'none' },
  },
  finance_officer: {
    label: 'Finance Officer',
    canManageUsers: false,
    modules: { scheduling: 'read', staff: 'none', hr: 'none', compliance: 'none', governance: 'none', finance: 'write', payroll: 'write', gdpr: 'none', reports: 'read', config: 'none' },
  },
  hr_officer: {
    label: 'HR Officer',
    canManageUsers: false,
    modules: { scheduling: 'read', staff: 'write', hr: 'write', compliance: 'none', governance: 'none', finance: 'none', payroll: 'none', gdpr: 'read', reports: 'read', config: 'none' },
  },
  shift_coordinator: {
    label: 'Shift Coordinator',
    canManageUsers: false,
    modules: { scheduling: 'write', staff: 'read', hr: 'none', compliance: 'none', governance: 'none', finance: 'none', payroll: 'none', gdpr: 'none', reports: 'read', config: 'none' },
  },
  viewer: {
    label: 'Viewer',
    canManageUsers: false,
    modules: { scheduling: 'read', staff: 'read', hr: 'none', compliance: 'none', governance: 'none', finance: 'none', payroll: 'none', gdpr: 'none', reports: 'read', config: 'none' },
  },
  staff_member: {
    label: 'Staff Member',
    canManageUsers: false,
    modules: { scheduling: 'own', staff: 'none', hr: 'none', compliance: 'none', governance: 'none', finance: 'none', payroll: 'own', gdpr: 'none', reports: 'none', config: 'none' },
  },
};

/** All valid role IDs */
export const ROLE_IDS = Object.keys(ROLES);

/**
 * Check if a role has access to a module at the given level.
 * @param {string} roleId — key from ROLES
 * @param {string} moduleId — key from MODULES
 * @param {string} level — 'read' | 'write' | 'own'
 * @returns {boolean}
 */
export function hasModuleAccess(roleId, moduleId, level = 'read') {
  const role = ROLES[roleId];
  if (!role) return false;
  const access = role.modules[moduleId];
  if (!access || access === 'none') return false;

  if (level === 'own') return access === 'own' || access === 'read' || access === 'write';
  if (level === 'read') return access === 'read' || access === 'write' || access === 'own';
  if (level === 'write') return access === 'write';
  return false;
}

/**
 * Get all modules a role can access (read or higher).
 * @param {string} roleId
 * @returns {string[]}
 */
export function getVisibleModules(roleId) {
  const role = ROLES[roleId];
  if (!role) return [];
  return Object.entries(role.modules)
    .filter(([, level]) => level !== 'none')
    .map(([mod]) => mod);
}

/**
 * Check if a role can write to a module (convenience for frontend).
 * @param {string} roleId
 * @param {string} moduleId
 * @returns {boolean}
 */
export function canWriteModule(roleId, moduleId) {
  return hasModuleAccess(roleId, moduleId, 'write');
}

/**
 * Check if an assigner role can assign a target role.
 * Rules:
 * - home_manager can assign anything except home_manager
 * - Only platform admin can assign home_manager (checked separately, not here)
 * - Other roles cannot assign anyone
 * @param {string} assignerRoleId
 * @param {string} targetRoleId
 * @returns {boolean}
 */
export function canAssignRole(assignerRoleId, targetRoleId) {
  const assigner = ROLES[assignerRoleId];
  if (!assigner?.canManageUsers) return false;
  // Home managers can assign all roles except home_manager
  return targetRoleId !== 'home_manager';
}

/**
 * Get the display label for a role.
 * @param {string} roleId
 * @returns {string}
 */
export function getRoleLabel(roleId) {
  return ROLES[roleId]?.label || roleId;
}

/**
 * Check if a role has own-data-only access for a module.
 * @param {string} roleId
 * @param {string} moduleId
 * @returns {boolean}
 */
export function isOwnDataOnly(roleId, moduleId) {
  const role = ROLES[roleId];
  if (!role) return false;
  return role.modules[moduleId] === 'own';
}
