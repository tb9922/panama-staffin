import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import PerformanceTracker from '../PerformanceTracker.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHrPerformance: vi.fn(),
    createHrPerformance: vi.fn(),
    updateHrPerformance: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([
      { id: 'S004', name: 'Jane Carer', role: 'Carer', active: true },
    ]),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

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

function renderAdmin() {
  return renderWithProviders(<PerformanceTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getHrPerformance.mockResolvedValue(MOCK_RESPONSE);
  api.getHrStaffList.mockResolvedValue([
    { id: 'S004', name: 'Jane Carer', role: 'Carer', active: true },
  ]);
});

describe('PerformanceTracker', () => {
  it('smoke test - renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.queryByText(/Loading performance/i) || screen.queryByText(/Performance Management/i)).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getHrPerformance.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading performance cases...')).toBeInTheDocument();
  });

  it('shows retryable error state when API call fails', async () => {
    api.getHrPerformance.mockRejectedValue(new Error('Timeout'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Timeout')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('displays page heading and subtitle after load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Performance Management')).toBeInTheDocument();
    });
    expect(screen.getByText('Capability concerns, PIPs, and performance hearings')).toBeInTheDocument();
  });

  it('displays case row with staff ID and date', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('S004')).toBeInTheDocument();
    });
    expect(screen.getByText('2026-01-10')).toBeInTheDocument();
  });

  it('shows action-first empty state when no cases exist', async () => {
    api.getHrPerformance.mockResolvedValue(EMPTY_RESPONSE);
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('No performance cases yet')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('button', { name: /New Case/i }).length).toBeGreaterThan(1);
  });

  it('shows filter dropdowns for status and type', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByDisplayValue('All Statuses')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('All Types')).toBeInTheDocument();
  });

  it('shows a success notice after creating a performance case', async () => {
    const user = userEvent.setup();
    api.createHrPerformance.mockResolvedValue({ id: 'PERF-002' });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Case/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /New Case/i }));
    await user.selectOptions(screen.getByLabelText(/Staff Member/i), 'S004');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createHrPerformance).toHaveBeenCalledWith('test-home', expect.objectContaining({
        staff_id: 'S004',
      }));
    });

    await waitFor(() => {
      expect(screen.getByText('Performance case created.')).toBeInTheDocument();
    });
  });
});
