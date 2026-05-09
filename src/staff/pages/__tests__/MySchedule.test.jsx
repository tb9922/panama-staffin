import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders.jsx';
import MySchedule from '../MySchedule.jsx';

vi.mock('../../../lib/api.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getMySchedule: vi.fn(),
  };
});

import { getMySchedule } from '../../../lib/api.js';

describe('MySchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMySchedule.mockResolvedValue({
      days: [
        {
          date: '2026-05-09',
          shift: 'E',
          scheduledShift: 'E',
          isOverride: false,
        },
        {
          date: '2026-05-10',
          shift: 'AL',
          scheduledShift: 'L',
          isOverride: true,
          reason: 'Approved leave',
        },
      ],
    });
  });

  it('loads the current month with bounded from/to dates', async () => {
    renderWithProviders(<MySchedule />);

    expect(await screen.findByText('My Schedule')).toBeInTheDocument();
    expect(getMySchedule).toHaveBeenCalledWith(expect.objectContaining({
      from: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
    expect(screen.getByText('2026-05-09')).toBeInTheDocument();
    expect(screen.getByText('Approved leave')).toBeInTheDocument();
  });

  it('navigates between months without requesting an unbounded schedule', async () => {
    renderWithProviders(<MySchedule />);
    await screen.findByText('2026-05-09');
    const firstRange = getMySchedule.mock.calls[0][0];

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));

    await waitFor(() => {
      expect(getMySchedule).toHaveBeenCalledTimes(2);
    });
    const nextRange = getMySchedule.mock.calls[1][0];
    expect(nextRange.from).not.toBe(firstRange.from);
    expect(nextRange.to).not.toBe(firstRange.to);

    fireEvent.click(screen.getByRole('button', { name: 'Current month' }));
    await waitFor(() => {
      expect(getMySchedule).toHaveBeenCalledTimes(3);
    });
    expect(getMySchedule.mock.calls[2][0]).toEqual(firstRange);
  });

  it('shows an empty state when no shifts are returned', async () => {
    getMySchedule.mockResolvedValueOnce({ days: [] });

    renderWithProviders(<MySchedule />);

    expect(await screen.findByText('No shifts found')).toBeInTheDocument();
  });

  it('offers retry after the initial load fails', async () => {
    getMySchedule.mockRejectedValueOnce(new Error('Session expired')).mockResolvedValueOnce({ days: [] });

    renderWithProviders(<MySchedule />);

    expect(await screen.findByText('Unable to load your schedule')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(getMySchedule).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('No shifts found')).toBeInTheDocument();
  });
});
