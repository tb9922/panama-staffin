import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { createMockDataContext } from './dataContextMock.js';

function currentMockDataContext() {
  try {
    return useData.getMockImplementation?.()?.();
  } catch {
    return null;
  }
}

/**
 * Render a component wrapped in all required providers.
 * Uses createMemoryRouter (required by useBlocker in useDirtyGuard).
 * Sets localStorage so AuthContext → getLoggedInUser() works.
 *
 * DataContext is always set explicitly here. By default this helper renders
 * as a home manager; pass homeRole/canRead/canWrite for role-sensitive cases.
 */
export function renderWithProviders(ui, {
  route = '/',
  path = '*',
  user = { username: 'admin', role: 'admin' },
  canRead,
  canWrite,
  homeRole = 'home_manager',
  isPlatformAdmin = false,
  activeHome = 'test-home',
  activeHomeObj,
  staffPortalEnabled = true,
  staffId = null,
  routes = [],
  renderOptions = {},
} = {}) {
  const resolvedHomeRole = canWrite === false && homeRole === 'home_manager' ? 'viewer' : homeRole;
  const hasDataContextOptions = canRead !== undefined
    || canWrite !== undefined
    || homeRole !== 'home_manager'
    || isPlatformAdmin !== false
    || activeHome !== 'test-home'
    || activeHomeObj !== undefined
    || staffPortalEnabled !== true
    || staffId !== null;
  const currentCtx = currentMockDataContext();
  if (hasDataContextOptions || currentCtx?.__testDataContext === true) {
    useData.mockReturnValue(createMockDataContext({
      activeHome,
      activeHomeObj,
      staffPortalEnabled,
      canRead,
      canWrite,
      homeRole: resolvedHomeRole,
      isPlatformAdmin,
      staffId,
    }));
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
