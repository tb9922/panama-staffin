import { hasModuleAccess, canWriteModule } from '../../shared/roles.js';
import { SCAN_INTAKE_TARGET_IDS } from '../../shared/scanIntake.js';

export const DEFAULT_TEST_HOME_ROLE = 'viewer';

function resolveAccessOverride(value, fallback) {
  if (typeof value === 'function') return value;
  if (typeof value === 'boolean') return () => value;
  return fallback;
}

export function createMockDataContext(overrides = {}) {
  const {
    activeHome = 'test-home',
    activeHomeObj,
    canRead,
    canWrite,
    homeRole = DEFAULT_TEST_HOME_ROLE,
    isPlatformAdmin = false,
    scanIntakeEnabled = true,
    scanIntakeTargets = SCAN_INTAKE_TARGET_IDS,
    staffId = null,
    staffPortalEnabled = true,
    ...rest
  } = overrides;

  const roleCanRead = (moduleId) => Boolean(
    isPlatformAdmin || hasModuleAccess(homeRole, moduleId, 'read')
  );
  const roleCanWrite = (moduleId) => Boolean(
    isPlatformAdmin || canWriteModule(homeRole, moduleId)
  );
  const resolvedActiveHomeObj = activeHomeObj ?? {
    id: activeHome,
    roleId: homeRole,
    staffId,
    scanIntakeEnabled,
    scanIntakeTargets,
    staffPortalEnabled,
  };

  return {
    __testDataContext: true,
    loading: false,
    error: null,
    homes: activeHome ? [resolvedActiveHomeObj] : [],
    activeHome,
    switchHome: () => {},
    refreshHomes: async () => {},
    setError: () => {},
    clearError: () => {},
    canRead: resolveAccessOverride(canRead, roleCanRead),
    canWrite: resolveAccessOverride(canWrite, roleCanWrite),
    homeRole,
    isPlatformAdmin,
    staffId,
    activeHomeObj: resolvedActiveHomeObj,
    scanIntakeEnabled,
    scanIntakeTargets,
    isScanTargetEnabled: (targetId) => (
      Boolean(scanIntakeEnabled)
      && Boolean(targetId)
      && scanIntakeTargets.includes(targetId)
    ),
    staffPortalEnabled,
    ...rest,
  };
}
