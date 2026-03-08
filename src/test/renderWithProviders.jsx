import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext.jsx';

/**
 * Render a component wrapped in all required providers.
 * Uses createMemoryRouter (required by useBlocker in useDirtyGuard).
 * Sets sessionStorage so AuthContext → getLoggedInUser() works.
 */
export function renderWithProviders(ui, {
  route = '/',
  user = { username: 'admin', role: 'admin' },
  renderOptions = {},
} = {}) {
  sessionStorage.setItem('user', JSON.stringify(user));
  const router = createMemoryRouter(
    [{ path: '*', element: ui }],
    { initialEntries: [route] },
  );
  return {
    user,
    ...render(<AuthProvider><RouterProvider router={router} /></AuthProvider>, renderOptions),
  };
}
