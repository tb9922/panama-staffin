import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { MOCK_SCHEDULING_DATA, MOCK_CONFIG } from '../../test/fixtures/schedulingData.js';
import CostTracker from '../CostTracker.jsx';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getSchedulingData: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

vi.mock('../../hooks/useLiveDate.js', () => ({
  useLiveDate: vi.fn(() => '2026-03-08'),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import * as api from '../../lib/api.js';
import { downloadXLSX } from '../../lib/excel.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getSchedulingData.mockResolvedValue(MOCK_SCHEDULING_DATA);
  return renderWithProviders(<CostTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  api.getSchedulingData.mockResolvedValue(MOCK_SCHEDULING_DATA);
  return renderWithProviders(<CostTracker />, {
    user: { username: 'viewer', role: 'viewer' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CostTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  });

  it('smoke test — renders without crashing for admin', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Cost Tracker')).toBeInTheDocument()
    );
  });

  it('shows loading text initially', () => {
    // Keep promise pending so we stay in loading state
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<CostTracker />, { user: { username: 'admin', role: 'admin' } });
    expect(screen.getByText('Loading cost data...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getSchedulingData.mockRejectedValue(new Error('Server unavailable'));
    renderWithProviders(<CostTracker />, { user: { username: 'admin', role: 'admin' } });
    await waitFor(() =>
      expect(screen.getByText('Server unavailable')).toBeInTheDocument()
    );
    expect(screen.queryByText('Cost Tracker')).not.toBeInTheDocument();
  });

  it('viewer sees "Admin access required" message instead of cost data', async () => {
    renderViewer();
    // Viewer check is synchronous — no loading phase to wait for
    await waitFor(() =>
      expect(screen.getByText('Admin access required to view cost data.')).toBeInTheDocument()
    );
    expect(screen.queryByText('Loading cost data...')).not.toBeInTheDocument();
  });

  it('renders daily cost table with expected columns for admin', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Cost Tracker')).toBeInTheDocument()
    );
    expect(screen.getByRole('columnheader', { name: 'Day#' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Base £' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Total £' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Cumul £' })).toBeInTheDocument();
  });

  it('shows period total summary row in table footer', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Cost Tracker')).toBeInTheDocument()
    );
    // Footer row shows "Month Total (N days)"
    expect(screen.getByText(/Month Total \(\d+ days\)/)).toBeInTheDocument();
  });

  it('renders the 5 summary KPI cards', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Cost Tracker')).toBeInTheDocument()
    );
    expect(screen.getByText('Month Total')).toBeInTheDocument();
    expect(screen.getByText('Monthly Proj')).toBeInTheDocument();
    expect(screen.getByText('Annual Proj')).toBeInTheDocument();
    expect(screen.getByText('Agency Total')).toBeInTheDocument();
    expect(screen.getByText('Agency %')).toBeInTheDocument();
  });

  it('month navigation arrows are present and change displayed month', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Cost Tracker')).toBeInTheDocument()
    );

    // Check nav arrows are rendered (← and →)
    const prevBtn = screen.getByRole('button', { name: /←/ });
    const nextBtn = screen.getByRole('button', { name: /→/ });
    expect(prevBtn).toBeInTheDocument();
    expect(nextBtn).toBeInTheDocument();

    // Get the current month label
    const now = new Date();
    const currentLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    expect(screen.getByText(currentLabel)).toBeInTheDocument();

    // Navigate forward one month
    await user.click(nextBtn);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextLabel = nextMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    expect(screen.getByText(nextLabel)).toBeInTheDocument();

    // "Current" link should appear when not on current month
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('Export CSV button is present for admin', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Cost Tracker')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
  });

  it('cost breakdown section lists expected categories', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Cost Breakdown')).toBeInTheDocument()
    );
    expect(screen.getByText('Base Staff')).toBeInTheDocument();
    expect(screen.getByText('OT Premium')).toBeInTheDocument();
    expect(screen.getByText('Agency Day')).toBeInTheDocument();
    expect(screen.getByText('Agency Night')).toBeInTheDocument();
    expect(screen.getByText('BH Premium')).toBeInTheDocument();
  });
});
