import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { loadHomes, setCurrentHome } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';

const DataCtx = createContext(null);

export function DataProvider({ children }) {
  const { logout } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [homes, setHomes] = useState([]);
  const [activeHome, setActiveHome] = useState(null);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    loadHomes()
      .then(h => {
        setHomes(h);
        const firstHome = h[0]?.id || 'default';
        setActiveHome(firstHome);
        setCurrentHome(firstHome);
      })
      .catch(e => {
        if (e.status === 401) { logout(); return; }
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [logout]);

  const switchHome = useCallback((homeId) => {
    setActiveHome(homeId);
    setCurrentHome(homeId);
  }, []);

  const refreshHomes = useCallback(async () => {
    try {
      const h = await loadHomes();
      setHomes(h);
      if (!h.find(x => x.id === activeHome)) {
        const first = h[0]?.id || 'default';
        setActiveHome(first);
        setCurrentHome(first);
      }
    } catch (e) {
      console.error('Failed to refresh homes:', e.message);
    }
  }, [activeHome]);

  return (
    <DataCtx.Provider value={{
      loading, error, homes, activeHome,
      switchHome, refreshHomes, setError, clearError,
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
