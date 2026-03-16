import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
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
  renderOptions = {},
} = {}) {
  // Override DataContext mock based on canWrite option
  if (!canWrite) {
    useData.mockReturnValue({
      canRead: () => true,
      canWrite: () => false,
      homeRole: 'viewer',
      staffId: null,
    });
  }
  localStorage.setItem('user', JSON.stringify(user));
  const router = createMemoryRouter(
    [{ path, element: ui }],
    { initialEntries: [route] },
  );
  return {
    user,
    ...render(<AuthProvider><RouterProvider router={router} /></AuthProvider>, renderOptions),
  };
}
