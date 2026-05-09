import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders.jsx';
import MyAnnualLeave from '../MyAnnualLeave.jsx';

vi.mock('../../../lib/api.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getMyAccrual: vi.fn(),
    getMyOverrideRequests: vi.fn(),
    createMyLeaveRequest: vi.fn(),
    cancelMyOverrideRequest: vi.fn(),
  };
});

import {
  getMyAccrual,
  getMyOverrideRequests,
  createMyLeaveRequest,
  cancelMyOverrideRequest,
} from '../../../lib/api.js';

describe('MyAnnualLeave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyAccrual.mockResolvedValue({
      accruedHours: 82,
      usedHours: 12,
      remainingHours: 70,
    });
    getMyOverrideRequests.mockResolvedValue([
      { id: 7, date: '2026-04-21', reason: 'Family event', status: 'pending', version: 3 },
    ]);
  });

  it('loads the leave summary and current requests', async () => {
    renderWithProviders(<MyAnnualLeave />, {
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    expect(await screen.findByText('Request leave')).toBeInTheDocument();
    expect(screen.getByText('82.0h')).toBeInTheDocument();
    expect(screen.getByText('70.0h')).toBeInTheDocument();
    expect(screen.getByText('2026-04-21')).toBeInTheDocument();
    expect(screen.getByText('Family event')).toBeInTheDocument();
  });

  it('submits a new leave request', async () => {
    createMyLeaveRequest.mockResolvedValue({ ok: true });

    renderWithProviders(<MyAnnualLeave />, {
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    await screen.findByText('Request leave');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-06-28' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Appointment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => {
      expect(createMyLeaveRequest).toHaveBeenCalledWith({
        date: '2026-06-28',
        reason: 'Appointment',
      });
    });
  });

  it('blocks past leave dates before submission', async () => {
    createMyLeaveRequest.mockResolvedValue({ ok: true });

    renderWithProviders(<MyAnnualLeave />, {
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    await screen.findByText('Request leave');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-01-01' } });

    expect(screen.getByText('Choose today or a future date.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();
    expect(createMyLeaveRequest).not.toHaveBeenCalled();
  });

  it('offers retry after the initial leave load fails', async () => {
    getMyAccrual.mockRejectedValueOnce(new Error('Session expired')).mockResolvedValueOnce({
      accruedHours: 0,
      usedHours: 0,
      remainingHours: 0,
    });
    getMyOverrideRequests.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    renderWithProviders(<MyAnnualLeave />, {
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    expect(await screen.findByText('Unable to load leave details')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(getMyAccrual).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('Request leave')).toBeInTheDocument();
  });

  it('cancels a pending request using its optimistic version', async () => {
    const user = userEvent.setup();
    cancelMyOverrideRequest.mockResolvedValue({ ok: true });

    renderWithProviders(<MyAnnualLeave />, {
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    await screen.findByText('Family event');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));

    await waitFor(() => {
      expect(cancelMyOverrideRequest).toHaveBeenCalledWith(7, 3);
    });
  });
});
