import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// Save original to restore between tests — without this the geolocation stub
// leaks across files in the same Vitest worker.
const originalGeolocation = Object.getOwnPropertyDescriptor(
  globalThis.navigator,
  'geolocation',
);

function stubGeolocation(impl) {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(impl) },
  });
}

function stubGeoSuccess() {
  stubGeolocation((resolve) => resolve({
    coords: { latitude: 51.501, longitude: -0.141, accuracy: 12 },
  }));
}

function stubGeoError(code) {
  stubGeolocation((_resolve, reject) => reject({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }));
}

function defaultDataContext(overrides = {}) {
  return {
    canRead: () => true,
    canWrite: () => false,
    homeRole: 'staff_member',
    staffId: 'S001',
    activeHomeObj: { id: 'amberwood', clockInRequired: true, ...overrides },
  };
}

describe('ClockInButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useData.mockReturnValue(defaultDataContext());
    getClockInState.mockResolvedValue({
      today: '2026-04-17',
      nextAction: 'in',
      lastClock: null,
    });
    recordClockIn.mockResolvedValue({ ok: true });
    stubGeoSuccess();
  });

  afterEach(() => {
    if (originalGeolocation) {
      Object.defineProperty(globalThis.navigator, 'geolocation', originalGeolocation);
    } else {
      delete globalThis.navigator.geolocation;
    }
  });

  it('stays hidden when clock-in is not enabled for the active home', () => {
    useData.mockReturnValue(defaultDataContext({ clockInRequired: false }));
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

  it('shows specific message when location permission is denied', async () => {
    stubGeoError(1);  // PERMISSION_DENIED
    renderWithProviders(<ClockInButton />, {
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    await screen.findByText('Ready to clock in?');
    fireEvent.click(screen.getByRole('button', { name: 'Clock in' }));

    await waitFor(() => {
      expect(screen.getByText(/permission was denied/i)).toBeInTheDocument();
    });
    expect(recordClockIn).not.toHaveBeenCalled();
  });

  it('shows specific message when location is unavailable', async () => {
    stubGeoError(2);  // POSITION_UNAVAILABLE
    renderWithProviders(<ClockInButton />, {
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    await screen.findByText('Ready to clock in?');
    fireEvent.click(screen.getByRole('button', { name: 'Clock in' }));

    await waitFor(() => {
      expect(screen.getByText(/cannot get a location fix/i)).toBeInTheDocument();
    });
  });

  it('renders Clock out label when nextAction is out', async () => {
    getClockInState.mockResolvedValue({
      today: '2026-04-17',
      nextAction: 'out',
      lastClock: { clockType: 'in', serverTime: new Date().toISOString() },
    });
    renderWithProviders(<ClockInButton />, {
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    expect(await screen.findByRole('button', { name: 'Clock out' })).toBeInTheDocument();
  });
});
