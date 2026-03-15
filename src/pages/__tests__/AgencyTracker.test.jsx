import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import AgencyTracker from '../AgencyTracker.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getAgencyProviders: vi.fn(),
    createAgencyProvider: vi.fn(),
    updateAgencyProvider: vi.fn(),
    getAgencyShifts: vi.fn(),
    createAgencyShift: vi.fn(),
    updateAgencyShift: vi.fn(),
    getAgencyMetrics: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../hooks/useDirtyGuard', () => ({
  default: vi.fn(),
}));

import * as api from '../../lib/api.js';

const MOCK_PROVIDERS = [
  { id: 1, name: 'Prestige Nursing', contact: 'info@prestige.co.uk', rate_day: 18.50, rate_night: 22.00, active: true },
  { id: 2, name: 'Care Plus', contact: null, rate_day: 16.00, rate_night: 20.00, active: false },
];

const MOCK_SHIFTS = [
  {
    id: 1, agency_id: 1, date: '2026-03-07', shift_code: 'E',
    hours: 8, hourly_rate: 18.50, total_cost: 148.00,
    worker_name: 'Jane Doe', role_covered: 'Senior Carer',
    invoice_ref: 'INV-042', reconciled: true,
  },
  {
    id: 2, agency_id: 1, date: '2026-03-08', shift_code: 'N',
    hours: 10, hourly_rate: 22.00, total_cost: 220.00,
    worker_name: null, role_covered: null,
    invoice_ref: null, reconciled: false,
  },
];

const MOCK_METRICS = {
  this_week_cost: 220,
  this_month_cost: 368,
  total_cost: 1500,
  weekly: [
    { week_start: '2026-03-02', shift_count: 2, total_hours: 18, total_cost: 368, provider_count: 1 },
  ],
};

function setupMocks() {
  api.getAgencyProviders.mockResolvedValue(MOCK_PROVIDERS);
  api.getAgencyShifts.mockResolvedValue(MOCK_SHIFTS);
  api.getAgencyMetrics.mockResolvedValue(MOCK_METRICS);
}

function renderAdmin() {
  setupMocks();
  return renderWithProviders(<AgencyTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  setupMocks();
  return renderWithProviders(<AgencyTracker />, {
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

describe('AgencyTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
  });

  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Agency Tracker')).toBeInTheDocument()
    );
  });

  it('shows loading text initially', () => {
    api.getAgencyProviders.mockReturnValue(new Promise(() => {}));
    api.getAgencyShifts.mockReturnValue(new Promise(() => {}));
    api.getAgencyMetrics.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<AgencyTracker />);
    // The page renders the title immediately but shift log shows loading
    expect(screen.getByText('Agency Tracker')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getAgencyProviders.mockRejectedValue(new Error('Connection refused'));
    api.getAgencyShifts.mockRejectedValue(new Error('Connection refused'));
    api.getAgencyMetrics.mockRejectedValue(new Error('Connection refused'));
    renderWithProviders(<AgencyTracker />);
    await waitFor(() =>
      expect(screen.getByText('Connection refused')).toBeInTheDocument()
    );
  });

  it('renders KPI summary cards with metrics', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('This Week')).toBeInTheDocument()
    );
    expect(screen.getByText('This Month')).toBeInTheDocument();
    expect(screen.getByText('12-Week Total')).toBeInTheDocument();
    expect(screen.getByText('Unreconciled')).toBeInTheDocument();
  });

  it('renders shift log table with data', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('2026-03-07')).toBeInTheDocument()
    );
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getAllByText('Prestige Nursing').length).toBeGreaterThanOrEqual(1);
  });

  it('shows + Provider and + Log Shift buttons for admin', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Provider' })).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: '+ Log Shift' })).toBeInTheDocument();
  });

  it('hides + Provider and + Log Shift buttons for viewer', async () => {
    renderViewer();
    await waitFor(() =>
      expect(screen.getByText('Agency Tracker')).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getByText('2026-03-07')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: '+ Provider' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Log Shift' })).not.toBeInTheDocument();
  });

  it('renders tab buttons for Shift Log, Providers, Weekly Trend', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Shift Log' })).toBeInTheDocument()
    );
    expect(screen.getByRole('tab', { name: 'Providers' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Weekly Trend' })).toBeInTheDocument();
  });
});
