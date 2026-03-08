import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import AppLayout from '../AppLayout.jsx';

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('../../contexts/AuthContext.jsx', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: vi.fn(),
}));

vi.mock('../../contexts/DataContext.jsx', () => ({
  DataProvider: ({ children }) => children,
  useData: vi.fn(),
}));

// AppRoutes renders real lazy-loaded pages — stub it to keep tests fast
vi.mock('../AppRoutes.jsx', () => ({
  default: () => <div data-testid="app-routes">Page Content</div>,
}));

// CoverageAlertBanner fetches scheduling data — stub it
vi.mock('../CoverageAlertBanner.jsx', () => ({
  default: () => <div data-testid="coverage-alert-banner" />,
}));

// api.js — stub changeOwnPassword (used by ChangePasswordModal)
vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    changeOwnPassword: vi.fn(),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    logout: vi.fn(),
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

import { useAuth } from '../../contexts/AuthContext.jsx';
import { useData } from '../../contexts/DataContext.jsx';

const ADMIN_USER = { username: 'admin', role: 'admin', displayName: 'Admin User' };
const VIEWER_USER = { username: 'viewer', role: 'viewer', displayName: 'View Only' };

const ONE_HOME = [{ id: 'home-1', name: 'Sunrise Care Home' }];
const TWO_HOMES = [
  { id: 'home-1', name: 'Sunrise Care Home' },
  { id: 'home-2', name: 'Meadowbrook' },
];

function mockAuth(overrides = {}) {
  useAuth.mockReturnValue({
    user: ADMIN_USER,
    isViewer: false,
    isPlatformAdmin: false,
    logout: vi.fn(),
    ...overrides,
  });
}

function mockData(overrides = {}) {
  useData.mockReturnValue({
    loading: false,
    error: null,
    homes: ONE_HOME,
    activeHome: 'home-1',
    switchHome: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  });
}

function renderLayout(userOption = {}) {
  // renderWithProviders wraps in AuthProvider + RouterProvider.
  // Since we mock useAuth/useData, the providers are pass-through.
  return renderWithProviders(<AppLayout />, { user: userOption });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AppLayout', () => {
  beforeEach(() => {
    mockAuth();
    mockData();
  });

  // 1. Loading spinner
  it('renders loading spinner when data is loading', () => {
    mockData({ loading: true });
    renderLayout();
    expect(screen.getByText('Loading staffing data...')).toBeInTheDocument();
    // Main layout should not render while loading
    expect(screen.queryByTestId('app-routes')).not.toBeInTheDocument();
  });

  // 2. Error state (fatal — no homes loaded)
  it('renders full-screen error state when error occurs before any homes load', () => {
    mockData({ error: 'Database connection failed', homes: [] });
    renderLayout();
    expect(screen.getByText('Error Loading Data')).toBeInTheDocument();
    expect(screen.getByText('Database connection failed')).toBeInTheDocument();
    expect(screen.getByText(/Make sure the API server is running/)).toBeInTheDocument();
  });

  // 3. Non-fatal error (homes already loaded) shows inline banner, not full-screen
  it('shows inline error banner when error occurs after homes are loaded', () => {
    mockData({ error: 'Save failed', homes: ONE_HOME });
    renderLayout();
    // Full-screen error should NOT appear
    expect(screen.queryByText('Error Loading Data')).not.toBeInTheDocument();
    // Inline banner should appear in the main content area
    expect(screen.getByText('Save failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  // 4. Sidebar navigation groups are rendered
  it('shows sidebar navigation section labels', () => {
    renderLayout();
    expect(screen.getByText('Scheduling')).toBeInTheDocument();
    expect(screen.getByText('Staff')).toBeInTheDocument();
    expect(screen.getByText('Compliance')).toBeInTheDocument();
    expect(screen.getByText('Governance')).toBeInTheDocument();
  });

  // 5. User info in sidebar
  it('shows username and role in the sidebar footer', () => {
    mockAuth({ user: ADMIN_USER, isViewer: false });
    renderLayout();
    expect(screen.getByText('Admin User')).toBeInTheDocument();
    expect(screen.getByText(/\(admin\)/)).toBeInTheDocument();
  });

  it('shows username when displayName is absent', () => {
    mockAuth({ user: { username: 'alice', role: 'admin' }, isViewer: false });
    renderLayout();
    // Username appears in the sidebar footer (text-gray-300 span) — use getAllByText
    // because mobile top bar also renders it
    const matches = screen.getAllByText('alice');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  // 6. Admin sees admin-only sections (HR, Finance)
  it('admin user sees the HR & People nav section', () => {
    mockAuth({ user: ADMIN_USER, isViewer: false, isPlatformAdmin: false });
    renderLayout();
    expect(screen.getByText('HR & People')).toBeInTheDocument();
  });

  it('admin user sees the Finance nav section', () => {
    mockAuth({ user: ADMIN_USER, isViewer: false, isPlatformAdmin: false });
    renderLayout();
    expect(screen.getByText('Finance')).toBeInTheDocument();
  });

  // 7. Viewer does NOT see admin-only sections (HR, Finance)
  it('viewer user does not see the HR & People nav section', () => {
    mockAuth({ user: VIEWER_USER, isViewer: true, isPlatformAdmin: false });
    renderLayout({ username: 'viewer', role: 'viewer' });
    expect(screen.queryByText('HR & People')).not.toBeInTheDocument();
  });

  it('viewer user does not see the Finance nav section', () => {
    mockAuth({ user: VIEWER_USER, isViewer: true, isPlatformAdmin: false });
    renderLayout({ username: 'viewer', role: 'viewer' });
    expect(screen.queryByText('Finance')).not.toBeInTheDocument();
  });

  // 8. Platform section only visible to platform admin
  it('platform admin sees the Platform nav section', () => {
    mockAuth({ user: ADMIN_USER, isViewer: false, isPlatformAdmin: true });
    renderLayout();
    expect(screen.getByText('Platform')).toBeInTheDocument();
  });

  it('non-platform admin does not see the Platform nav section', () => {
    mockAuth({ user: ADMIN_USER, isViewer: false, isPlatformAdmin: false });
    renderLayout();
    expect(screen.queryByText('Platform')).not.toBeInTheDocument();
  });

  // 9. Viewer sees read-only mode banner
  it('shows read-only mode banner for viewer role', () => {
    mockAuth({ user: VIEWER_USER, isViewer: true, isPlatformAdmin: false });
    renderLayout({ username: 'viewer', role: 'viewer' });
    expect(screen.getByText(/Read-only mode/)).toBeInTheDocument();
  });

  it('does not show read-only banner for admin role', () => {
    mockAuth({ user: ADMIN_USER, isViewer: false });
    renderLayout();
    expect(screen.queryByText(/Read-only mode/)).not.toBeInTheDocument();
  });

  // 10. Coverage alert banner is rendered
  it('renders the coverage alert banner', () => {
    renderLayout();
    expect(screen.getByTestId('coverage-alert-banner')).toBeInTheDocument();
  });

  // 11. Home selector visible when multiple homes exist
  it('shows home selector dropdown when multiple homes are available', () => {
    mockData({ homes: TWO_HOMES, activeHome: 'home-1' });
    renderLayout();
    const selector = screen.getByRole('combobox');
    expect(selector).toBeInTheDocument();
    expect(screen.getByText('Sunrise Care Home')).toBeInTheDocument();
    expect(screen.getByText('Meadowbrook')).toBeInTheDocument();
  });

  // 12. No home selector when only one home
  it('does not show home selector when only one home exists', () => {
    mockData({ homes: ONE_HOME, activeHome: 'home-1' });
    renderLayout();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  // 13. App routes are rendered inside main content area
  it('renders the main page content area', () => {
    renderLayout();
    expect(screen.getByTestId('app-routes')).toBeInTheDocument();
  });

  // 14. Logout and Password buttons present in sidebar
  it('shows Logout and Password buttons in the sidebar footer', () => {
    renderLayout();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Password' })).toBeInTheDocument();
  });

  // 15. Top-level nav items (Dashboard)
  it('renders Dashboard top-level nav link', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: /Dashboard/ })).toBeInTheDocument();
  });
});
