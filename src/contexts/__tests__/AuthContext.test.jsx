import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, renderHook } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext.jsx';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  getLoggedInUser: vi.fn(),
  logout: vi.fn(),
}));

// Renders AuthProvider and exposes context values as text nodes for assertion.
function TestConsumer() {
  const { user, isViewer, isPlatformAdmin } = useAuth();
  return (
    <div>
      <span data-testid="username">{user ? user.username : 'none'}</span>
      <span data-testid="role">{user ? user.role : 'none'}</span>
      <span data-testid="isViewer">{String(isViewer)}</span>
      <span data-testid="isPlatformAdmin">{String(isPlatformAdmin)}</span>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>,
  );
}

describe('AuthContext', () => {
  it('provides user from getLoggedInUser on mount', () => {
    api.getLoggedInUser.mockReturnValue({ username: 'alice', role: 'admin', isPlatformAdmin: false });

    renderWithProvider();

    expect(screen.getByTestId('username').textContent).toBe('alice');
    expect(screen.getByTestId('role').textContent).toBe('admin');
  });

  it('isViewer is true when user.role is viewer', () => {
    api.getLoggedInUser.mockReturnValue({ username: 'bob', role: 'viewer', isPlatformAdmin: false });

    renderWithProvider();

    expect(screen.getByTestId('isViewer').textContent).toBe('true');
  });

  it('isViewer is false when user.role is admin', () => {
    api.getLoggedInUser.mockReturnValue({ username: 'carol', role: 'admin', isPlatformAdmin: false });

    renderWithProvider();

    expect(screen.getByTestId('isViewer').textContent).toBe('false');
  });

  it('isPlatformAdmin reflects user.isPlatformAdmin', () => {
    api.getLoggedInUser.mockReturnValue({ username: 'dan', role: 'admin', isPlatformAdmin: true });

    renderWithProvider();

    expect(screen.getByTestId('isPlatformAdmin').textContent).toBe('true');
  });

  it('login() updates user state', async () => {
    api.getLoggedInUser.mockReturnValue(null);

    // Use renderHook so we can call login() directly from the context.
    const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.user).toBeNull();

    await act(async () => {
      result.current.login({ username: 'eve', role: 'admin', isPlatformAdmin: false });
    });

    expect(result.current.user).toEqual({ username: 'eve', role: 'admin', isPlatformAdmin: false });
    expect(result.current.isViewer).toBe(false);
  });

  it('logout() calls apiLogout and sets user to null', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'frank', role: 'admin', isPlatformAdmin: false });

    const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.user).not.toBeNull();

    await act(async () => {
      result.current.logout();
    });

    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(result.current.user).toBeNull();
  });

  it('useAuth() throws when used outside AuthProvider', () => {
    // Suppress the React error boundary console noise for this assertion.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth must be used within AuthProvider',
    );

    consoleError.mockRestore();
  });
});
