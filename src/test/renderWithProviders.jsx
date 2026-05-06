import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { SCAN_INTAKE_TARGET_IDS } from '../../shared/scanIntake.js';
import { AuthProvider } from '../contexts/AuthContext.jsx';
import { useData } from '../contexts/DataContext.jsx';

/**
 * Render a component wrapped in all required providers.
 * Uses createMemoryRouter (required by useBlocker in useDirtyGuard).
 * Sets localStorage so AuthContext → getLoggedInUser() works.
 *
 * When canWrite is false, overrides the DataContext mock to return viewer
 * permissions (canWrite: () => false, homeRole: 'viewer').
 */
export function renderWithProviders(ui, {
  route = '/',
  path = '*',
  user = { username: 'admin', role: 'admin' },
  canWrite = true,
  homeRole = 'home_manager',
  isPlatformAdmin = false,
  routes = [],
  renderOptions = {},
} = {}) {
  const shouldOverrideDataContext = canWrite !== true || homeRole !== 'home_manager' || isPlatformAdmin;
  if (shouldOverrideDataContext) {
    const resolvedHomeRole = canWrite === false && homeRole === 'home_manager' ? 'viewer' : homeRole;
    const canWriteFn = typeof canWrite === 'function' ? canWrite : () => Boolean(canWrite);
    useData.mockReturnValue({
      loading: false,
      error: null,
      homes: [],
      activeHome: 'test-home',
      switchHome: () => {},
      refreshHomes: async () => {},
      setError: () => {},
      clearError: () => {},
      canRead: () => true,
      canWrite: canWriteFn,
      homeRole: resolvedHomeRole,
      isPlatformAdmin,
      staffId: null,
      activeHomeObj: {
        roleId: resolvedHomeRole,
        staffId: null,
        scanIntakeEnabled: true,
        staffPortalEnabled: true,
      },
      scanIntakeEnabled: true,
      scanIntakeTargets: SCAN_INTAKE_TARGET_IDS,
      isScanTargetEnabled: () => true,
      staffPortalEnabled: true,
    });
  }
  localStorage.setItem('user', JSON.stringify(user));
  const router = createMemoryRouter(
    [{ path, element: ui }, ...routes],
    { initialEntries: [route] },
  );
  return {
    user,
    router,
    ...render(<AuthProvider><RouterProvider router={router} /></AuthProvider>, renderOptions),
  };
}
