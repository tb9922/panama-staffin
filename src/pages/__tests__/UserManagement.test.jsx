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
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    resetUserPassword: vi.fn(),
    getUserHomes: vi.fn(),
    setUserHomes: vi.fn(),
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
    role: 'admin',
    active: true,
    last_login_at: '2026-03-08T09:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 2,
    username: 'viewer1',
    display_name: 'Viewer One',
    role: 'viewer',
    active: true,
    last_login_at: null,
    created_at: '2025-06-01T00:00:00Z',
  },
  {
    id: 3,
    username: 'olduser',
    display_name: null,
    role: 'viewer',
    active: false,
    last_login_at: null,
    created_at: '2024-01-01T00:00:00Z',
  },
];

const MOCK_HOMES = [{ id: 1, name: 'Test Care Home' }];

describe('UserManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listUsers.mockResolvedValue(MOCK_USERS);
    api.listAllHomesForAccess.mockResolvedValue(MOCK_HOMES);
    api.getUserHomes.mockResolvedValue({ homeIds: [1] });
  });

  it('shows loading state initially', () => {
    api.listUsers.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<UserManagement />);
    expect(screen.getByText(/loading users/i)).toBeInTheDocument();
  });

  it('renders the page heading after load', async () => {
    renderWithProviders(<UserManagement />);
    await waitFor(() => expect(screen.getByText('User Management')).toBeInTheDocument());
  });

  it('displays users in the table', async () => {
    renderWithProviders(<UserManagement />);
    // 'admin' appears as username cell and as role badge — use getAllByText
    await waitFor(() => expect(screen.getAllByText('admin').length).toBeGreaterThan(0));
    expect(screen.getByText('viewer1')).toBeInTheDocument();
    expect(screen.getByText('olduser')).toBeInTheDocument();
  });

  it('shows role badges for users', async () => {
    renderWithProviders(<UserManagement />);
    await waitFor(() => expect(screen.getAllByText('admin').length).toBeGreaterThan(0));
    // viewer role badge appears for viewer1 and olduser
    expect(screen.getAllByText('viewer').length).toBeGreaterThan(0);
  });

  it('shows active/inactive status badges', async () => {
    renderWithProviders(<UserManagement />);
    await waitFor(() => expect(screen.getAllByText('Active').length).toBeGreaterThan(0));
    expect(screen.getByText('Inactive')).toBeInTheDocument();
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

  it('shows error message on API failure', async () => {
    api.listUsers.mockRejectedValue(new Error('Auth required'));
    renderWithProviders(<UserManagement />);
    await waitFor(() => expect(screen.getByText('Auth required')).toBeInTheDocument());
  });
});
