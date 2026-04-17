import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { loadHomes, setCurrentHome } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';
import { hasModuleAccess, canWriteModule } from '../../shared/roles.js';
import { SCAN_INTAKE_TARGET_IDS } from '../../shared/scanIntake.js';

const DataCtx = createContext(null);

export function DataProvider({ children }) {
  const { logout, isPlatformAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [homes, setHomes] = useState([]);
  const [activeHome, setActiveHome] = useState(null);

  const clearError = useCallback(() => setError(null), []);

  const applyActiveHome = useCallback((homeId) => {
    setActiveHome(homeId);
    setCurrentHome(homeId);
    try {
      if (homeId) localStorage.setItem('currentHome', homeId);
      else localStorage.removeItem('currentHome');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadHomes()
      .then(h => {
        setHomes(h);
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('currentHome') : null;
        const firstHome = (saved && h.find(x => x.id === saved)) ? saved : (h[0]?.id || null);
        applyActiveHome(firstHome);
      })
      .catch(e => {
        if (e.status === 401) { void logout({ forceLocal: true }); return; }
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [applyActiveHome, logout]);

  const switchHome = useCallback((homeId) => {
    applyActiveHome(homeId);
  }, [applyActiveHome]);

  const refreshHomes = useCallback(async () => {
    try {
      const h = await loadHomes();
      setHomes(h);
      if (!h.find(x => x.id === activeHome)) {
        const first = h[0]?.id || null;
        applyActiveHome(first);
      }
    } catch (e) {
      console.error('Failed to refresh homes:', e.message);
    }
  }, [activeHome, applyActiveHome]);

  // Derive current home's role from the homes array
  const activeHomeObj = useMemo(() => homes.find(h => h.id === activeHome), [homes, activeHome]);
  const homeRole = activeHomeObj?.roleId || null;
  const staffId = activeHomeObj?.staffId || null;
  const scanIntakeEnabled = Boolean(activeHomeObj?.scanIntakeEnabled ?? activeHomeObj?.config?.scan_intake_enabled);
  const scanIntakeTargets = useMemo(() => {
    const configured = activeHomeObj?.scanIntakeTargets ?? activeHomeObj?.config?.scan_intake_targets;
    if (Array.isArray(configured) && configured.length > 0) {
      return configured.filter((target) => SCAN_INTAKE_TARGET_IDS.includes(target));
    }
    return SCAN_INTAKE_TARGET_IDS;
  }, [activeHomeObj]);

  // Module access helpers bound to current home's role (platform admins bypass)
  const canRead = useCallback((moduleId) => {
    if (isPlatformAdmin) return true;
    return hasModuleAccess(homeRole, moduleId, 'read');
  }, [homeRole, isPlatformAdmin]);

  const canWrite = useCallback((moduleId) => {
    if (isPlatformAdmin) return true;
    return canWriteModule(homeRole, moduleId);
  }, [homeRole, isPlatformAdmin]);

  const isScanTargetEnabled = useCallback((targetId) => {
    if (!scanIntakeEnabled) return false;
    if (!targetId) return false;
    return scanIntakeTargets.includes(targetId);
  }, [scanIntakeEnabled, scanIntakeTargets]);

  return (
    <DataCtx.Provider value={{
      loading, error, homes, activeHome,
      switchHome, refreshHomes, setError, clearError,
      homeRole, staffId, canRead, canWrite,
      activeHomeObj, scanIntakeEnabled, scanIntakeTargets, isScanTargetEnabled,
    }}>
      {children}
    </DataCtx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useData() {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
