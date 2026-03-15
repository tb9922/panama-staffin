import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import Residents from '../Residents.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getResidentsWithBeds: vi.fn(),
    getBeds: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

const MOCK_RESIDENTS = {
  rows: [
    {
      id: 1, resident_name: 'Mrs Joan Smith', room_number: '101',
      care_type: 'residential', funding_type: 'self_funded', status: 'active',
      weekly_fee: 950, outstanding_balance: 200, next_fee_review: '2026-06-01',
      bed: { id: 'bed-1', room_number: '101', status: 'occupied' },
    },
    {
      id: 2, resident_name: 'Mr Albert Jones', room_number: '102',
      care_type: 'nursing', funding_type: 'la_funded', status: 'active',
      weekly_fee: 1200, outstanding_balance: 0, next_fee_review: null,
      bed: { id: 'bed-2', room_number: '102', status: 'occupied' },
    },
    {
      id: 3, resident_name: 'Mrs Elsie Brown', room_number: null,
      care_type: 'residential', funding_type: 'self_funded', status: 'discharged',
      weekly_fee: 900, outstanding_balance: 0, next_fee_review: null,
      bed: null,
    },
  ],
  total: 3,
};

const MOCK_BEDS = {
  beds: [
    { id: 'bed-1', room_number: '101', status: 'occupied' },
    { id: 'bed-2', room_number: '102', status: 'occupied' },
    { id: 'bed-3', room_number: '103', status: 'available' },
  ],
};

function setupMocks() {
  api.getResidentsWithBeds.mockResolvedValue(MOCK_RESIDENTS);
  api.getBeds.mockResolvedValue(MOCK_BEDS);
}

function renderAdmin() {
  setupMocks();
  return renderWithProviders(<Residents />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  setupMocks();
  return renderWithProviders(<Residents />, {
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

describe('Residents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  });

  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Residents')).toBeInTheDocument()
    );
  });

  it('shows loading text initially', () => {
    api.getResidentsWithBeds.mockReturnValue(new Promise(() => {}));
    api.getBeds.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<Residents />);
    expect(screen.getByText('Loading residents...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getResidentsWithBeds.mockRejectedValue(new Error('Forbidden'));
    api.getBeds.mockResolvedValue(MOCK_BEDS);
    renderWithProviders(<Residents />);
    await waitFor(() =>
      expect(screen.getByText('Forbidden')).toBeInTheDocument()
    );
  });

  it('renders resident names after load', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Mrs Joan Smith')).toBeInTheDocument()
    );
    expect(screen.getByText('Mr Albert Jones')).toBeInTheDocument();
    expect(screen.getByText('Mrs Elsie Brown')).toBeInTheDocument();
  });

  it('shows Admit Resident button for admin', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Admit Resident' })).toBeInTheDocument()
    );
  });

  it('hides Admit Resident button for viewer', async () => {
    renderViewer();
    await waitFor(() =>
      expect(screen.getByText('Mrs Joan Smith')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Admit Resident' })).not.toBeInTheDocument();
  });

  it('shows resident count', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('3 residents')).toBeInTheDocument()
    );
  });

  it('handles beds API failure gracefully', async () => {
    api.getResidentsWithBeds.mockResolvedValue(MOCK_RESIDENTS);
    api.getBeds.mockRejectedValue(new Error('Beds not found'));
    renderWithProviders(<Residents />);
    // Page should still render residents despite beds failure
    await waitFor(() =>
      expect(screen.getByText('Mrs Joan Smith')).toBeInTheDocument()
    );
  });
});
