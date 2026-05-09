import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders.jsx';
import MyTraining from '../MyTraining.jsx';

vi.mock('../../../lib/api.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getMyTraining: vi.fn(),
    acknowledgeMyTraining: vi.fn(),
  };
});

import { getMyTraining, acknowledgeMyTraining } from '../../../lib/api.js';

function trainingPayload(overrides = {}) {
  return {
    items: [
      {
        id: 'fire-safety',
        name: 'Fire Safety',
        status: 'complete',
        expiry: '2027-05-01',
        acknowledgedByStaff: false,
      },
      {
        id: 'infection-control',
        name: 'Infection Control',
        status: 'expired',
        expiry: '2026-01-01',
        acknowledgedByStaff: false,
      },
    ],
    ...overrides,
  };
}

describe('MyTraining', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyTraining.mockResolvedValue(trainingPayload());
    acknowledgeMyTraining.mockResolvedValue({ ok: true });
  });

  it('loads training status and only shows acknowledge for current complete items', async () => {
    renderWithProviders(<MyTraining />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    expect(await screen.findByText('My Training')).toBeInTheDocument();
    expect(screen.getByText('Fire Safety')).toBeInTheDocument();
    expect(screen.getByText('Infection Control')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
    expect(screen.getByText('expired')).toBeInTheDocument();
  });

  it('acknowledges a completed item and reloads the list', async () => {
    renderWithProviders(<MyTraining />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    await screen.findByText('Fire Safety');
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

    await waitFor(() => {
      expect(acknowledgeMyTraining).toHaveBeenCalledWith('fire-safety');
    });
    expect(getMyTraining).toHaveBeenCalledTimes(2);
  });

  it('shows an update error when acknowledge fails', async () => {
    acknowledgeMyTraining.mockRejectedValueOnce(new Error('Training record not found'));

    renderWithProviders(<MyTraining />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    await screen.findByText('Fire Safety');
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

    expect(await screen.findByText('Training update failed')).toBeInTheDocument();
    expect(screen.getByText('Training record not found')).toBeInTheDocument();
  });

  it('offers retry after the initial training load fails', async () => {
    getMyTraining.mockRejectedValueOnce(new Error('Session expired')).mockResolvedValueOnce({ items: [] });

    renderWithProviders(<MyTraining />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    expect(await screen.findByText('Unable to load training')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(getMyTraining).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('No training items')).toBeInTheDocument();
  });
});
