import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import FamilyLeaveTracker from '../FamilyLeaveTracker.jsx';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHrFamilyLeave: vi.fn(),
    createHrFamilyLeave: vi.fn(),
    updateHrFamilyLeave: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const MOCK_MATERNITY = {
  id: 'FL-001',
  staff_id: 'S010',
  leave_type: 'maternity',
  start_date: '2026-04-01',
  end_date: '2027-03-31',
  status: 'active',
  expected_return: '2027-04-01',
  actual_return: '',
  kit_days_used: 3,
  pay_type: 'SMP',
  version: 1,
};

const MOCK_PATERNITY = {
  id: 'FL-002',
  staff_id: 'S011',
  leave_type: 'paternity',
  start_date: '2026-05-10',
  end_date: '2026-05-24',
  status: 'planned',
  expected_return: '2026-05-25',
  actual_return: '',
  kit_days_used: 0,
  pay_type: 'SPP',
  version: 1,
};

const MOCK_RESPONSE = { rows: [MOCK_MATERNITY], total: 1 };
const EMPTY_RESPONSE = { rows: [], total: 0 };

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  api.getCurrentHome.mockReturnValue('test-home');
  api.getHrFamilyLeave.mockResolvedValue(MOCK_RESPONSE);
  api.getHrStaffList.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('FamilyLeaveTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderWithProviders(<FamilyLeaveTracker />);
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading family leave/i) ||
        screen.queryByText(/Family Leave/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getHrFamilyLeave.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<FamilyLeaveTracker />);
    expect(screen.getByText('Loading family leave data...')).toBeInTheDocument();
  });

  it('shows error banner when API call fails', async () => {
    api.getHrFamilyLeave.mockRejectedValue(new Error('Permission denied'));
    renderWithProviders(<FamilyLeaveTracker />);
    await waitFor(() => {
      expect(screen.getByText('Permission denied')).toBeInTheDocument();
    });
  });

  it('displays page heading after load', async () => {
    renderWithProviders(<FamilyLeaveTracker />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Family Leave' })).toBeInTheDocument();
    });
  });

  it('displays leave record row with staff ID and dates', async () => {
    renderWithProviders(<FamilyLeaveTracker />);
    await waitFor(() => {
      expect(screen.getByText('S010')).toBeInTheDocument();
    });
    expect(screen.getByText('2026-04-01')).toBeInTheDocument();
  });

  it('shows Protected badge for maternity leave', async () => {
    renderWithProviders(<FamilyLeaveTracker />);
    await waitFor(() => {
      expect(screen.getByText('Protected')).toBeInTheDocument();
    });
  });

  it('does not show Protected badge for paternity leave', async () => {
    api.getHrFamilyLeave.mockResolvedValue({ rows: [MOCK_PATERNITY], total: 1 });
    renderWithProviders(<FamilyLeaveTracker />);
    await waitFor(() => {
      expect(screen.getByText('S011')).toBeInTheDocument();
    });
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('shows empty state when no records exist', async () => {
    api.getHrFamilyLeave.mockResolvedValue(EMPTY_RESPONSE);
    renderWithProviders(<FamilyLeaveTracker />);
    await waitFor(() => {
      expect(screen.getByText('No family leave records')).toBeInTheDocument();
    });
  });

  it('shows New Leave Record button', async () => {
    renderWithProviders(<FamilyLeaveTracker />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Leave Record/i })).toBeInTheDocument();
    });
  });
});
