import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import StaffInviteSetup from '../StaffInviteSetup.jsx';

vi.mock('../../lib/api.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getLoggedInUser: vi.fn(),
    getStaffInvite: vi.fn(),
    consumeStaffInvite: vi.fn(),
  };
});

import { getLoggedInUser, getStaffInvite, consumeStaffInvite } from '../../lib/api.js';

const TOKEN = 'a'.repeat(64);

function renderInvite({ token = TOKEN, onLogin = vi.fn() } = {}) {
  const router = createMemoryRouter(
    [
      { path: '/staff-setup', element: <StaffInviteSetup onLogin={onLogin} /> },
      { path: '/', element: <div>Signed in</div> },
    ],
    { initialEntries: [`/staff-setup${token ? `?token=${token}` : ''}`] },
  );
  return {
    onLogin,
    router,
    ...render(<RouterProvider router={router} />),
  };
}

describe('StaffInviteSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLoggedInUser.mockReturnValue(null);
    getStaffInvite.mockResolvedValue({
      staffName: 'Alice Carer',
      homeName: 'Amberwood',
      expiresAt: '2026-05-31T10:00:00Z',
    });
    consumeStaffInvite.mockResolvedValue({
      username: 'alice',
      role: 'staff_member',
      displayName: 'Alice Carer',
    });
  });

  it('shows a clear error when the invite token is missing', async () => {
    renderInvite({ token: '' });

    expect(await screen.findByText('Invite unavailable')).toBeInTheDocument();
    expect(screen.getByText('Invite link is missing a token.')).toBeInTheDocument();
    expect(getStaffInvite).not.toHaveBeenCalled();
  });

  it('validates password length and confirmation before consuming the invite', async () => {
    renderInvite();

    expect(await screen.findByText('Set up your sign-in')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Choose a username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Create a password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete setup' }));

    expect(await screen.findByText('Password must be at least 10 characters.')).toBeInTheDocument();
    expect(consumeStaffInvite).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Create a password'), { target: { value: 'long-password-1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'long-password-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete setup' }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(consumeStaffInvite).not.toHaveBeenCalled();
  });

  it('consumes a valid invite once and signs the staff member in', async () => {
    let resolveInvite;
    consumeStaffInvite.mockReturnValue(new Promise((resolve) => {
      resolveInvite = resolve;
    }));
    const { onLogin } = renderInvite();

    expect(await screen.findByText('Set up your sign-in')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Choose a username'), { target: { value: ' alice ' } });
    fireEvent.change(screen.getByLabelText('Create a password'), { target: { value: 'long-password-1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'long-password-1' } });
    const submit = screen.getByRole('button', { name: 'Complete setup' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(consumeStaffInvite).toHaveBeenCalledTimes(1);
    expect(consumeStaffInvite).toHaveBeenCalledWith({
      token: TOKEN,
      username: 'alice',
      password: 'long-password-1',
    });

    resolveInvite({ username: 'alice', role: 'staff_member', displayName: 'Alice Carer' });
    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({ username: 'alice', role: 'staff_member', displayName: 'Alice Carer' });
    });
    expect(await screen.findByText('Signed in')).toBeInTheDocument();
  });
});
