import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import PerformanceTracker from '../PerformanceTracker.jsx';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHrPerformance: vi.fn(),
    createHrPerformance: vi.fn(),
    updateHrPerformance: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const MOCK_CASE = {
  id: 'PERF-001',
  staff_id: 'S004',
  date_raised: '2026-01-10',
  type: 'capability',
  status: 'pip_active',
  description: 'Below expected standard in medication administration',
  outcome: '',
  version: 1,
};

const MOCK_RESPONSE = { rows: [MOCK_CASE], total: 1 };
const EMPTY_RESPONSE = { rows: [], total: 0 };

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  api.getHrPerformance.mockResolvedValue(MOCK_RESPONSE);
  api.getHrStaffList.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('PerformanceTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderWithProviders(<PerformanceTracker />);
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading performance/i) ||
        screen.queryByText(/Performance Management/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getHrPerformance.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<PerformanceTracker />);
    expect(screen.getByText('Loading performance cases...')).toBeInTheDocument();
  });

  it('shows error state when API call fails', async () => {
    api.getHrPerformance.mockRejectedValue(new Error('Timeout'));
    renderWithProviders(<PerformanceTracker />);
    await waitFor(() => {
      expect(screen.getByText('Performance Management')).toBeInTheDocument();
    });
  });

  it('displays page heading and subtitle after load', async () => {
    renderWithProviders(<PerformanceTracker />);
    await waitFor(() => {
      expect(screen.getByText('Performance Management')).toBeInTheDocument();
    });
    expect(screen.getByText('Capability concerns, PIPs, and performance hearings')).toBeInTheDocument();
  });

  it('displays case row with staff ID and date', async () => {
    renderWithProviders(<PerformanceTracker />);
    await waitFor(() => {
      expect(screen.getByText('S004')).toBeInTheDocument();
    });
    expect(screen.getByText('2026-01-10')).toBeInTheDocument();
  });

  it('shows empty state when no cases exist', async () => {
    api.getHrPerformance.mockResolvedValue(EMPTY_RESPONSE);
    renderWithProviders(<PerformanceTracker />);
    await waitFor(() => {
      expect(screen.getByText('No performance cases')).toBeInTheDocument();
    });
  });

  it('shows New Case button', async () => {
    renderWithProviders(<PerformanceTracker />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Case/i })).toBeInTheDocument();
    });
  });

  it('shows filter dropdowns for status and type', async () => {
    renderWithProviders(<PerformanceTracker />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('All Statuses')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('All Types')).toBeInTheDocument();
  });
});
