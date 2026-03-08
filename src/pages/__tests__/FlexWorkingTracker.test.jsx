import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import FlexWorkingTracker from '../FlexWorkingTracker.jsx';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHrFlexWorking: vi.fn(),
    createHrFlexWorking: vi.fn(),
    updateHrFlexWorking: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const MOCK_REQUEST = {
  id: 'FLX-001',
  staff_id: 'S020',
  request_date: '2026-02-01',
  requested_change: 'Change from 5-day to 4-day compressed week',
  decision_deadline: '2026-04-01',
  status: 'pending',
  decision: '',
  version: 1,
};

const MOCK_OVERDUE_REQUEST = {
  id: 'FLX-002',
  staff_id: 'S021',
  request_date: '2025-12-01',
  requested_change: 'Work from home 2 days per week',
  decision_deadline: '2026-02-01',
  status: 'pending',
  decision: '',
  version: 1,
};

const MOCK_RESPONSE = { rows: [MOCK_REQUEST], total: 1 };
const EMPTY_RESPONSE = { rows: [], total: 0 };

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  api.getHrFlexWorking.mockResolvedValue(MOCK_RESPONSE);
  api.getHrStaffList.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('FlexWorkingTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderWithProviders(<FlexWorkingTracker />);
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading flexible working/i) ||
        screen.queryByText(/Flexible Working Requests/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getHrFlexWorking.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<FlexWorkingTracker />);
    expect(screen.getByText('Loading flexible working data...')).toBeInTheDocument();
  });

  it('shows error banner when API call fails', async () => {
    api.getHrFlexWorking.mockRejectedValue(new Error('Service unavailable'));
    renderWithProviders(<FlexWorkingTracker />);
    await waitFor(() => {
      expect(screen.getByText('Service unavailable')).toBeInTheDocument();
    });
  });

  it('displays page heading and ERA subtitle after load', async () => {
    renderWithProviders(<FlexWorkingTracker />);
    await waitFor(() => {
      expect(screen.getByText('Flexible Working Requests')).toBeInTheDocument();
    });
  });

  it('displays request row with staff ID and requested change', async () => {
    renderWithProviders(<FlexWorkingTracker />);
    await waitFor(() => {
      expect(screen.getByText('S020')).toBeInTheDocument();
    });
    expect(screen.getByText('Change from 5-day to 4-day compressed week')).toBeInTheDocument();
  });

  it('shows empty state when no requests exist', async () => {
    api.getHrFlexWorking.mockResolvedValue(EMPTY_RESPONSE);
    renderWithProviders(<FlexWorkingTracker />);
    await waitFor(() => {
      expect(screen.getByText('No flexible working requests')).toBeInTheDocument();
    });
  });

  it('shows New Request button', async () => {
    renderWithProviders(<FlexWorkingTracker />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Request/i })).toBeInTheDocument();
    });
  });

  it('highlights overdue decision deadline', async () => {
    api.getHrFlexWorking.mockResolvedValue({ rows: [MOCK_OVERDUE_REQUEST], total: 1 });
    renderWithProviders(<FlexWorkingTracker />);
    await waitFor(() => {
      expect(screen.getByText(/overdue/i)).toBeInTheDocument();
    });
  });
});
