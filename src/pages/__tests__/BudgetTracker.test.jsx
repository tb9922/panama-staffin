import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { MOCK_SCHEDULING_DATA, MOCK_CONFIG } from '../../test/fixtures/schedulingData.js';
import BudgetTracker from '../BudgetTracker.jsx';

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
    saveConfig: vi.fn(),
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
// Fixtures
// ---------------------------------------------------------------------------

const SCHED_DATA_NO_BUDGET = {
  ...MOCK_SCHEDULING_DATA,
  config: {
    ...MOCK_CONFIG,
    monthly_staff_budget: 0,
    monthly_agency_cap: 0,
    budget_overrides: {},
  },
};

const SCHED_DATA_WITH_BUDGET = {
  ...MOCK_SCHEDULING_DATA,
  config: {
    ...MOCK_CONFIG,
    monthly_staff_budget: 50000,
    monthly_agency_cap: 5000,
    budget_overrides: {},
  },
};

function setupMocks(schedData = SCHED_DATA_NO_BUDGET) {
  api.getSchedulingData.mockResolvedValue(schedData);
  api.saveConfig.mockResolvedValue({});
}

function renderAdmin(schedData) {
  setupMocks(schedData);
  return renderWithProviders(<BudgetTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer(schedData) {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  setupMocks(schedData);
  return renderWithProviders(<BudgetTracker />, {
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BudgetTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  });

  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Budget vs Actual')).toBeInTheDocument()
    );
  });

  it('shows loading text initially', () => {
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<BudgetTracker />);
    expect(screen.getByText('Loading budget data...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getSchedulingData.mockRejectedValue(new Error('Network error'));
    renderWithProviders(<BudgetTracker />);
    await waitFor(() =>
      expect(screen.getByText('Network error')).toBeInTheDocument()
    );
    expect(screen.queryByText('Budget vs Actual')).not.toBeInTheDocument();
  });

  it('shows "No budget set" message when no budget is configured', async () => {
    renderAdmin(SCHED_DATA_NO_BUDGET);
    await waitFor(() =>
      expect(screen.getByText('Budget vs Actual')).toBeInTheDocument()
    );
    expect(screen.getByText('No budget set')).toBeInTheDocument();
  });

  it('shows budget summary cards when a budget is set', async () => {
    renderAdmin(SCHED_DATA_WITH_BUDGET);
    await waitFor(() =>
      expect(screen.getByText('Budget vs Actual')).toBeInTheDocument()
    );
    expect(screen.getByText('Monthly Budget')).toBeInTheDocument();
    expect(screen.getByText('YTD Variance')).toBeInTheDocument();
    expect(screen.getByText('Annual Forecast')).toBeInTheDocument();
    expect(screen.getByText('Agency YTD')).toBeInTheDocument();
  });

  it('renders the monthly detail table with expected columns', async () => {
    renderAdmin(SCHED_DATA_WITH_BUDGET);
    await waitFor(() =>
      expect(screen.getByText('Budget vs Actual')).toBeInTheDocument()
    );
    expect(screen.getByRole('columnheader', { name: 'Month' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Budget £' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Actual £' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Variance £' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Var %' })).toBeInTheDocument();
  });

  it('admin sees "Set Budget" button and per-month edit links', async () => {
    renderAdmin(SCHED_DATA_WITH_BUDGET);
    await waitFor(() =>
      expect(screen.getByText('Budget vs Actual')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Set Budget' })).toBeInTheDocument();
    // Each of the 12 months gets an edit link
    const editLinks = screen.getAllByText('edit');
    expect(editLinks.length).toBe(12);
  });

  it('viewer does not see "Set Budget" button or edit links', async () => {
    renderViewer(SCHED_DATA_WITH_BUDGET);
    await waitFor(() =>
      expect(screen.getByText('Budget vs Actual')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Set Budget' })).not.toBeInTheDocument();
    expect(screen.queryByText('edit')).not.toBeInTheDocument();
  });

  it('opens Set Budget modal when admin clicks Set Budget', async () => {
    const user = userEvent.setup();
    renderAdmin(SCHED_DATA_WITH_BUDGET);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Set Budget' })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: 'Set Budget' }));
    expect(screen.getByText('Set Monthly Budget')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. 50000')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. 5000')).toBeInTheDocument();
  });

  it('variance display shows over/under status with budget set', async () => {
    renderAdmin(SCHED_DATA_WITH_BUDGET);
    await waitFor(() =>
      expect(screen.getByText('Budget vs Actual')).toBeInTheDocument()
    );
    // With budget set, Status column shows OK/WARN/OVER badges
    const statusBadges = screen.getAllByText(/^(OK|WARN|OVER)$/);
    expect(statusBadges.length).toBeGreaterThan(0);
  });

  it('Export Excel button triggers downloadXLSX', async () => {
    const user = userEvent.setup();
    renderAdmin(SCHED_DATA_WITH_BUDGET);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export Excel' })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: 'Export Excel' }));
    expect(downloadXLSX).toHaveBeenCalledOnce();
  });
});
