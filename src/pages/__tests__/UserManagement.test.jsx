import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import UserManagement from '../UserManagement.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    listUsersForHome: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    resetUserPassword: vi.fn(),
    getUserHomeRole: vi.fn(),
    setUserHomeRole: vi.fn(),
    getUserAllRoles: vi.fn(),
    setUserRolesBulk: vi.fn(),
    listAllHomesForAccess: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

const MOCK_USERS = [
  {
    id: 1,
    username: 'admin',
    display_name: 'Admin User',
    role_id: 'home_manager',
    active: true,
    last_login_at: '2026-03-08T09:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 2,
    username: 'viewer1',
    display_name: 'Viewer One',
    role_id: 'viewer',
    active: true,
    last_login_at: null,
    created_at: '2025-06-01T00:00:00Z',
  },
  {
    id: 3,
    username: 'olduser',
    display_name: null,
    role_id: 'viewer',
    active: false,
    last_login_at: null,
    created_at: '2024-01-01T00:00:00Z',
  },
];

const MOCK_HOMES = [{ id: 1, name: 'Test Care Home' }];

describe('UserManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getCurrentHome.mockReturnValue('test-home');
    api.listUsersForHome.mockResolvedValue(MOCK_USERS);
    api.listAllHomesForAccess.mockResolvedValue(MOCK_HOMES);
    api.getUserHomeRole.mockResolvedValue({ role: 'home_manager' });
  });

  it('shows loading state initially', () => {
    api.listUsersForHome.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<UserManagement />);
    expect(screen.getByText(/loading users/i)).toBeInTheDocument();
  });

  it('renders the page heading after load', async () => {
    renderWithProviders(<UserManagement />);
    await waitFor(() => expect(screen.getByText('User Management')).toBeInTheDocument());
  });

  it('shows a no-home state instead of loading forever', async () => {
    api.getCurrentHome.mockReturnValue(null);
    renderWithProviders(<UserManagement />, { activeHome: null });
    expect(await screen.findByText('Select a home to manage users')).toBeInTheDocument();
    expect(api.listUsersForHome).not.toHaveBeenCalled();
  });

  it('displays users in the table', async () => {
    renderWithProviders(<UserManagement />);
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument());
    expect(screen.getByText('viewer1')).toBeInTheDocument();
    expect(screen.getByText('olduser')).toBeInTheDocument();
  });

  it('shows role badges for users', async () => {
    renderWithProviders(<UserManagement />);
    await waitFor(() => expect(screen.getAllByText('Home Manager').length).toBeGreaterThanOrEqual(1));
    // Viewer role badge appears for viewer1 and olduser
    expect(screen.getAllByText('Viewer').length).toBeGreaterThanOrEqual(2);
  });

  it('shows active/inactive status badges', async () => {
    renderWithProviders(<UserManagement />);
    await waitFor(() => expect(screen.getAllByText('Active').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
  });

  it('shows Add User button', async () => {
    renderWithProviders(<UserManagement />);
    await waitFor(() => expect(screen.getByRole('button', { name: /add user/i })).toBeInTheDocument());
  });

  it('opens Add User modal on button click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserManagement />);
    await waitFor(() => expect(screen.getByRole('button', { name: /add user/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /add user/i }));
    // Password field is unique to the modal (not in the table)
    expect(screen.getByText('Password')).toBeInTheDocument();
    expect(screen.getByText('Confirm Password')).toBeInTheDocument();
    // Cancel + Create User buttons appear in modal footer
    expect(screen.getByRole('button', { name: /create user/i })).toBeInTheDocument();
  });

  it('trims add-user values and blocks invalid passwords before save', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserManagement />);
    await user.click(await screen.findByRole('button', { name: /add user/i }));

    const createButton = screen.getByRole('button', { name: /create user/i });
    expect(createButton).toBeDisabled();

    await user.type(screen.getByLabelText('Username'), '  new.user  ');
    await user.type(screen.getByLabelText('Display Name'), '  New User  ');
    await user.type(screen.getByLabelText('Password'), 'StrongPass123');
    await user.type(screen.getByLabelText('Confirm Password'), 'Mismatch123');
    expect(createButton).toBeDisabled();

    await user.clear(screen.getByLabelText('Confirm Password'));
    await user.type(screen.getByLabelText('Confirm Password'), 'StrongPass123');
    await waitFor(() => expect(createButton).toBeEnabled());
    await user.click(createButton);

    await waitFor(() => {
      expect(api.createUser).toHaveBeenCalledWith('test-home', expect.objectContaining({
        username: 'new.user',
        displayName: 'New User',
      }));
    });
  });

  it('hides reset password action for non-platform admins', async () => {
    renderWithProviders(<UserManagement />);
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /reset pw/i })).not.toBeInTheDocument();
  });

  it('shows reset password action for platform admins', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin', isPlatformAdmin: true });
    renderWithProviders(<UserManagement />);
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /reset pw/i }).length).toBeGreaterThan(0);
  });

  it('shows error message on API failure', async () => {
    api.listUsersForHome.mockRejectedValue(new Error('Auth required'));
    renderWithProviders(<UserManagement />);
    await waitFor(() => expect(screen.getByText('Auth required')).toBeInTheDocument());
  });

  it('filters users by search text', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserManagement />);

    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/username, display name, staff id, or granted by/i), 'viewer');

    expect(screen.queryByText('admin')).not.toBeInTheDocument();
    expect(screen.getByText('viewer1')).toBeInTheDocument();
  });

  it('filters users by inactive status', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserManagement />);

    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Status'), 'inactive');

    expect(screen.getByText('olduser')).toBeInTheDocument();
    expect(screen.queryByText('viewer1')).not.toBeInTheDocument();
  });
});
