import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders.jsx';
import MyProfile from '../MyProfile.jsx';

vi.mock('../../../lib/api.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getMyProfile: vi.fn(),
    updateMyProfile: vi.fn(),
    staffChangePassword: vi.fn(),
  };
});

import { getMyProfile, updateMyProfile, staffChangePassword } from '../../../lib/api.js';

const PROFILE = {
  id: 'S001',
  name: 'Alice Carer',
  role: 'Carer',
  team: 'Day A',
  phone: '07700900000',
  address: '12 Test Lane',
  emergency_contact: 'Spouse 07700900111',
};

describe('MyProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyProfile.mockResolvedValue(PROFILE);
    updateMyProfile.mockResolvedValue({ ...PROFILE, phone: '07700900999' });
    staffChangePassword.mockResolvedValue({ ok: true });
  });

  it('loads the profile and only enables saving after a profile change', async () => {
    renderWithProviders(<MyProfile />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    expect(await screen.findByDisplayValue('Alice Carer')).toBeInTheDocument();
    const saveButton = screen.getByRole('button', { name: 'Save profile' });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: ' 07700900999 ' } });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(updateMyProfile).toHaveBeenCalledWith({
        phone: ' 07700900999 ',
        address: '12 Test Lane',
        emergency_contact: 'Spouse 07700900111',
      });
    });
    expect(await screen.findByText('Profile updated.')).toBeInTheDocument();
  });

  it('validates mismatched password confirmation before calling the API', async () => {
    renderWithProviders(<MyProfile />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    await screen.findByRole('button', { name: 'Change password' });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('New password and confirmation do not match.')).toBeInTheDocument();
    expect(staffChangePassword).not.toHaveBeenCalled();
  });

  it('changes password and clears password fields after success', async () => {
    renderWithProviders(<MyProfile />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    await screen.findByRole('button', { name: 'Change password' });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => {
      expect(staffChangePassword).toHaveBeenCalledWith('old-password', 'new-password-1');
    });
    expect(await screen.findByText('Password changed.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });
});
