import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders.jsx';
import ClockInButton from '../ClockInButton.jsx';
import { useData } from '../../../contexts/DataContext.jsx';

vi.mock('../../../lib/api.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getClockInState: vi.fn(),
    recordClockIn: vi.fn(),
  };
});

import { getClockInState, recordClockIn } from '../../../lib/api.js';

function setGeoSuccess() {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((resolve) => resolve({
        coords: {
          latitude: 51.501,
          longitude: -0.141,
          accuracy: 12,
        },
      })),
    },
  });
}

describe('ClockInButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useData.mockReturnValue({
      canRead: () => true,
      canWrite: () => false,
      homeRole: 'staff_member',
      staffId: 'S001',
      activeHomeObj: {
        id: 'amberwood',
        clockInRequired: true,
      },
    });
    getClockInState.mockResolvedValue({
      today: '2026-04-17',
      nextAction: 'in',
      lastClock: null,
    });
    recordClockIn.mockResolvedValue({ ok: true });
    setGeoSuccess();
  });

  it('stays hidden when clock-in is not enabled for the active home', () => {
    useData.mockReturnValue({
      canRead: () => true,
      canWrite: () => false,
      homeRole: 'staff_member',
      staffId: 'S001',
      activeHomeObj: {
        id: 'amberwood',
        clockInRequired: false,
      },
    });

    renderWithProviders(<ClockInButton />, {
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    expect(screen.queryByText('Clock-in')).not.toBeInTheDocument();
  });

  it('records a GPS clock-in with the current location', async () => {
    renderWithProviders(<ClockInButton />, {
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    expect(await screen.findByText('Ready to clock in?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clock in' }));

    await waitFor(() => {
      expect(recordClockIn).toHaveBeenCalledWith(expect.objectContaining({
        clockType: 'in',
        lat: 51.501,
        lng: -0.141,
        accuracyM: 12,
      }));
    });
  });
});
