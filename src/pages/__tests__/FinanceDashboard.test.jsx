import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import FinanceDashboard from '../FinanceDashboard.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getFinanceDashboard: vi.fn(),
    getFinanceAlerts: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

const MOCK_DASHBOARD = {
  income: {
    total_invoiced: 120000,
    invoice_count: 24,
  },
  expenses: {
    total_all: 95000,
    staff_costs: 80000,
    agency_costs: 15000,
  },
  net_position: 25000,
  margin: 20.8,
  occupancy: {
    rate: 92,
    active: 28,
    registered_beds: 30,
  },
  ageing: {
    total_outstanding: 8500,
    buckets: {
      current: 5000,
      days_1_30: 2000,
      days_31_60: 1000,
      days_61_90: 500,
      days_90_plus: 0,
    },
    overdue_items: [],
  },
  expenses_by_category: [
    { category: 'staffing', total: 80000, count: 100 },
    { category: 'agency', total: 15000, count: 12 },
  ],
  income_trend: [
    { month: '2026-01', invoiced: 38000 },
    { month: '2026-02', invoiced: 42000 },
  ],
  expense_trend: [
    { month: '2026-01', total: 30000 },
    { month: '2026-02', total: 32000 },
  ],
};

describe('FinanceDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getCurrentHome.mockReturnValue('test-home');
    api.getFinanceDashboard.mockResolvedValue(MOCK_DASHBOARD);
    api.getFinanceAlerts.mockResolvedValue([]);
  });

  it('shows loading state initially', () => {
    api.getFinanceDashboard.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<FinanceDashboard />);
    expect(screen.getByText(/loading finance data/i)).toBeInTheDocument();
  });

  it('renders page heading after load', async () => {
    renderWithProviders(<FinanceDashboard />);
    await waitFor(() => expect(screen.getByText('Finance Dashboard')).toBeInTheDocument());
  });

  it('shows KPI cards with income and expenses', async () => {
    renderWithProviders(<FinanceDashboard />);
    await waitFor(() => expect(screen.getByText('Income (Invoiced)')).toBeInTheDocument());
    expect(screen.getByText('Total Expenses')).toBeInTheDocument();
    expect(screen.getByText('Net Position')).toBeInTheDocument();
    expect(screen.getByText('Occupancy')).toBeInTheDocument();
  });

  it('shows occupancy rate from dashboard data', async () => {
    renderWithProviders(<FinanceDashboard />);
    await waitFor(() => expect(screen.getByText('92%')).toBeInTheDocument());
  });

  it('shows receivables ageing section', async () => {
    renderWithProviders(<FinanceDashboard />);
    await waitFor(() => expect(screen.getByText('Receivables Ageing')).toBeInTheDocument());
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('1-30 days')).toBeInTheDocument();
  });

  it('shows monthly summary trend table', async () => {
    renderWithProviders(<FinanceDashboard />);
    await waitFor(() => expect(screen.getByText(/monthly summary/i)).toBeInTheDocument());
    expect(screen.getByText('2026-01')).toBeInTheDocument();
    expect(screen.getByText('2026-02')).toBeInTheDocument();
  });

  it('shows error banner on API failure', async () => {
    api.getFinanceDashboard.mockRejectedValue(new Error('Access denied'));
    renderWithProviders(<FinanceDashboard />);
    await waitFor(() => expect(screen.getByText('Access denied')).toBeInTheDocument());
  });

  it('shows finance alerts when present', async () => {
    api.getFinanceAlerts.mockResolvedValue([
      { type: 'warning', message: 'Outstanding balance exceeds Â£5,000' },
    ]);
    renderWithProviders(<FinanceDashboard />);
    await waitFor(() => expect(screen.getByText('Outstanding balance exceeds Â£5,000')).toBeInTheDocument());
  });

  it('shows a degraded-data warning when optional finance inputs are unavailable', async () => {
    api.getFinanceDashboard.mockResolvedValue({
      ...MOCK_DASHBOARD,
      degraded: true,
      degraded_metrics: ['staff_costs', 'registered_beds'],
      expenses: {
        ...MOCK_DASHBOARD.expenses,
        staff_costs: null,
        total_all: null,
      },
      net_position: null,
      margin: null,
      occupancy: {
        ...MOCK_DASHBOARD.occupancy,
        rate: null,
        registered_beds: null,
      },
    });

    renderWithProviders(<FinanceDashboard />);

    await waitFor(() => expect(screen.getByText(/some finance inputs are unavailable right now/i)).toBeInTheDocument());
    expect(screen.getByText(/displayed totals may be incomplete/i)).toBeInTheDocument();
  });
});
