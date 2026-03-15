import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import PayrollDashboard from '../PayrollDashboard.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getPayrollRuns: vi.fn(),
    createPayrollRun: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../lib/payroll.js', () => ({
  suggestNextPeriod: vi.fn(() => ({
    start: '2026-03-01',
    end: '2026-03-31',
  })),
}));

import * as api from '../../lib/api.js';

const MOCK_RUNS = [
  {
    id: 'run-1',
    period_start: '2026-02-01',
    period_end: '2026-02-28',
    pay_frequency: 'monthly',
    status: 'approved',
    staff_count: 12,
    total_gross: '48500.00',
    total_enhancements: '3200.00',
    exported_at: '2026-03-01T09:00:00Z',
  },
  {
    id: 'run-2',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    pay_frequency: 'monthly',
    status: 'draft',
    staff_count: 11,
    total_gross: null,
    total_enhancements: null,
    exported_at: null,
  },
];

describe('PayrollDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getPayrollRuns.mockResolvedValue(MOCK_RUNS);
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
  });

  it('renders the page heading', async () => {
    renderWithProviders(<PayrollDashboard />);
    expect(screen.getByText('Payroll Runs')).toBeInTheDocument();
  });

  it('shows loading state while fetching', async () => {
    let resolve;
    api.getPayrollRuns.mockReturnValue(new Promise(r => { resolve = r; }));
    renderWithProviders(<PayrollDashboard />);
    expect(screen.getByText('Loading payroll runs…')).toBeInTheDocument();
    await act(async () => { resolve(MOCK_RUNS); });
  });

  it('renders runs table with correct data after load', async () => {
    renderWithProviders(<PayrollDashboard />);
    // Both cards and table may show 2026-02-01 — use getAllByText
    await waitFor(() => expect(screen.getAllByText('2026-02-01').length).toBeGreaterThan(0));
    expect(screen.getByText('2026-01-01')).toBeInTheDocument();
    // Status badges
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('displays summary cards for the latest run', async () => {
    renderWithProviders(<PayrollDashboard />);
    // £48,500.00 appears in both summary card and table row — that is correct
    await waitFor(() => expect(screen.getAllByText('£48,500.00').length).toBeGreaterThan(0));
    expect(screen.getAllByText('£3,200.00').length).toBeGreaterThan(0);
    // Staff count in card
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
  });

  it('shows New Payroll Run button for admins', async () => {
    renderWithProviders(<PayrollDashboard />);
    await waitFor(() => expect(screen.getByText('Approved')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /new payroll run/i })).toBeInTheDocument();
  });

  it('hides New Payroll Run button for viewers', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
    renderWithProviders(<PayrollDashboard />, { user: { username: 'viewer', role: 'viewer' }, canWrite: false });
    await waitFor(() => expect(screen.getByText('Approved')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /new payroll run/i })).not.toBeInTheDocument();
  });

  it('opens create modal when New Payroll Run is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PayrollDashboard />);
    await waitFor(() => expect(screen.getByText('Approved')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /new payroll run/i }));
    // Modal title appears
    expect(screen.getByText('New Payroll Run')).toBeInTheDocument();
    // Modal has Pay Frequency label text
    expect(screen.getByText('Pay Frequency')).toBeInTheDocument();
    // Modal has Period Start/End labels
    expect(screen.getByText('Period Start')).toBeInTheDocument();
  });

  it('shows error message on API failure', async () => {
    api.getPayrollRuns.mockRejectedValue(new Error('Network error'));
    renderWithProviders(<PayrollDashboard />);
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
  });

  it('shows empty state when no runs exist', async () => {
    api.getPayrollRuns.mockResolvedValue([]);
    renderWithProviders(<PayrollDashboard />);
    await waitFor(() => expect(screen.getByText(/no payroll runs yet/i)).toBeInTheDocument());
  });
});
