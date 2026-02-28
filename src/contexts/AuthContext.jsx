import { createContext, useContext, useState, useCallback } from 'react';
import { getLoggedInUser, logout as apiLogout } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getLoggedInUser);

  const handleLogin = useCallback((u) => setUser(u), []);

  const handleLogout = useCallback(() => {
    apiLogout();
    setUser(null);
  }, []);

  const isViewer = user?.role === 'viewer';

  return (
    <AuthContext.Provider value={{ user, isViewer, login: handleLogin, logout: handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
