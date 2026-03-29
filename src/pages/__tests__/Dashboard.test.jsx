import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { MOCK_SCHEDULING_DATA, MOCK_CONFIG } from '../../test/fixtures/schedulingData.js';
import { useData } from '../../contexts/DataContext.jsx';
import Dashboard from '../Dashboard.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getSchedulingData: vi.fn(),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHrStats: vi.fn().mockResolvedValue(null),
    getHrWarnings: vi.fn().mockResolvedValue([]),
    getFinanceAlerts: vi.fn().mockResolvedValue([]),
    getDashboardSummary: vi.fn().mockResolvedValue(null),
    setCurrentHome: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Care Home' }]),
    logout: vi.fn(),
  };
});

vi.mock('../../../shared/nmw.js', () => ({
  getMinimumWageRate: vi.fn(() => ({ rate: 12.21, label: 'NLW' })),
}));

vi.mock('../../lib/hr.js', () => ({
  getHrAlerts: vi.fn(() => []),
}));

vi.mock('../../lib/finance.js', () => ({
  getFinanceAlertsForDashboard: vi.fn(() => []),
}));

import * as api from '../../lib/api.js';

function renderDashboard(userOverride = { username: 'admin', role: 'admin' }, opts = {}) {
  return renderWithProviders(<Dashboard />, { user: userOverride, ...opts });
}

function buildCleanDashboardData() {
  return {
    ...MOCK_SCHEDULING_DATA,
    staff: [{
      id: 'S999',
      name: 'Safe Staff',
      role: 'Senior Carer',
      team: 'Day A',
      pref: 'EL',
      skill: 1.5,
      hourly_rate: 20.00,
      active: true,
      start_date: '2020-01-01',
      contract_hours: 37.5,
      wtr_opt_out: false,
      al_entitlement: null,
      al_carryover: 0,
      leaving_date: null,
      date_of_birth: null,
    }],
    overrides: {},
    config: {
      ...MOCK_CONFIG,
      minimum_staffing: {
        early: { heads: 0, skill_points: 0 },
        late: { heads: 0, skill_points: 0 },
        night: { heads: 0, skill_points: 0 },
      },
      max_consecutive_days: 14,
    },
  };
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getCurrentHome.mockReturnValue('test-home');
    api.getSchedulingData.mockResolvedValue(MOCK_SCHEDULING_DATA);
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getHrStats.mockResolvedValue(null);
    api.getHrWarnings.mockResolvedValue([]);
    api.getFinanceAlerts.mockResolvedValue([]);
    api.getDashboardSummary.mockResolvedValue(null);
  });

  it('shows loading indicator initially', async () => {
    let resolve;
    api.getSchedulingData.mockReturnValue(new Promise(r => { resolve = r; }));

    renderDashboard();

    expect(screen.getByText('Loading dashboard...')).toBeInTheDocument();

    await act(async () => { resolve(MOCK_SCHEDULING_DATA); });
  });

  it('renders home name and bed count after data loads', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText(MOCK_CONFIG.home_name)).toBeInTheDocument()
    );
    expect(screen.getByText(/30 beds/)).toBeInTheDocument();
  });

  it("renders Today's Coverage section", async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText(/Today's Coverage/)).toBeInTheDocument()
    );

    expect(screen.getByText('early')).toBeInTheDocument();
    expect(screen.getByText('late')).toBeInTheDocument();
    expect(screen.getByText('night')).toBeInTheDocument();
  });

  it('renders the Staffing Summary KPI card', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('Staffing Summary')).toBeInTheDocument()
    );

    expect(screen.getByText('On Duty')).toBeInTheDocument();
    expect(screen.getByText('Sick')).toBeInTheDocument();
    expect(screen.getByText('Annual Leave')).toBeInTheDocument();
    expect(screen.getByText('Total Staff')).toBeInTheDocument();
  });

  it('renders the Training Compliance card', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('Training Compliance')).toBeInTheDocument()
    );

    const status = screen.queryByText('Compliant')
      || screen.queryByText('At Risk')
      || screen.queryByText('Non-Compliant');
    expect(status).toBeInTheDocument();
  });

  it('renders the 28-Day Coverage Heatmap section with 28 day buttons', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('28-Day Coverage Heatmap')).toBeInTheDocument()
    );
    const dayLabels = screen.getAllByText(/^D\d+$/);
    expect(dayLabels).toHaveLength(28);
  });

  it('renders the Alerts section', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('Alerts')).toBeInTheDocument()
    );
  });

  it('admin sees the Cost Summary card with financial figures', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    renderDashboard({ username: 'admin', role: 'admin' });

    await waitFor(() =>
      expect(screen.getByText('Cost Summary (28-day)')).toBeInTheDocument()
    );
    expect(screen.getByText('This cycle:')).toBeInTheDocument();
    expect(screen.getByText('Monthly proj:')).toBeInTheDocument();
    expect(screen.getByText('Annual proj:')).toBeInTheDocument();
  });

  it('viewer with finance read access sees cost summary figures', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
    renderDashboard({ username: 'viewer', role: 'viewer' }, { canWrite: false });

    await waitFor(() =>
      expect(screen.getByText('Cost Summary (28-day)')).toBeInTheDocument()
    );
    expect(screen.getByText('This cycle:')).toBeInTheDocument();
    expect(screen.getByText('Monthly proj:')).toBeInTheDocument();
  });

  it('shows an error message when the scheduling API call fails', async () => {
    api.getSchedulingData.mockRejectedValue(new Error('Network timeout'));
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('Network timeout')).toBeInTheDocument()
    );
    expect(screen.queryByText('Loading dashboard...')).not.toBeInTheDocument();
  });

  it('shows a select-home state when no home is selected', async () => {
    api.getCurrentHome.mockReturnValue(null);
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('Select a home to view the dashboard.')).toBeInTheDocument()
    );
    expect(api.getSchedulingData).not.toHaveBeenCalled();
    expect(screen.queryByText('Loading dashboard...')).not.toBeInTheDocument();
  });

  it('shows all-clear message when there are no alerts for the schedule', async () => {
    api.getSchedulingData.mockResolvedValue(buildCleanDashboardData());
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('All clear — full coverage this cycle')).toBeInTheDocument()
    );
  });

  it('shows degraded messaging instead of a false all-clear when summary data fails', async () => {
    api.getSchedulingData.mockResolvedValue(buildCleanDashboardData());
    api.getDashboardSummary.mockRejectedValue(new Error('summary down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText(/Some dashboard data could not be loaded/)).toBeInTheDocument()
    );
    expect(screen.getByText('No alerts available while some dashboard data is unavailable')).toBeInTheDocument();
    warnSpy.mockRestore();
    expect(screen.queryByText('All clear — full coverage this cycle')).not.toBeInTheDocument();
  });

  it('shows Print button in header area', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText(MOCK_CONFIG.home_name)).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
  });

  it('renders Action This Week card when summary has weekActions', async () => {
    api.getDashboardSummary.mockResolvedValue({
      modules: {},
      alerts: [
        { type: 'error', module: 'incidents', message: 'CQC overdue', link: '/incidents', priority: 5 },
        { type: 'warning', module: 'training', message: '3 expired training', link: '/training', priority: 3 },
      ],
      weekActions: [
        { type: 'error', module: 'incidents', message: 'CQC overdue', link: '/incidents', priority: 5 },
        { type: 'warning', module: 'training', message: '3 expired training', link: '/training', priority: 3 },
      ],
    });
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('Action This Week')).toBeInTheDocument()
    );
    expect(screen.getAllByText('CQC overdue').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('3 expired training').length).toBeGreaterThanOrEqual(1);
  });

  it('does not render Action This Week card when weekActions is empty', async () => {
    api.getDashboardSummary.mockResolvedValue({
      modules: {},
      alerts: [],
      weekActions: [],
    });
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('Alerts')).toBeInTheDocument()
    );
    expect(screen.queryByText('Action This Week')).not.toBeInTheDocument();
  });

  it('does not render Action This Week card for viewer role', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
    api.getDashboardSummary.mockResolvedValue({
      modules: {},
      alerts: [],
      weekActions: [
        { type: 'error', module: 'incidents', message: 'CQC overdue', link: '/incidents', priority: 5 },
      ],
    });
    renderDashboard({ username: 'viewer', role: 'viewer' }, { canWrite: false });

    await waitFor(() =>
      expect(screen.getByText('Alerts')).toBeInTheDocument()
    );
    expect(screen.queryByText('Action This Week')).not.toBeInTheDocument();
  });

  it('renders the coverage heatmap legend', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('Covered')).toBeInTheDocument()
    );
    expect(screen.getByText('Float/OT')).toBeInTheDocument();
    expect(screen.getAllByText('Agency').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Short/Unsafe')).toBeInTheDocument();
  });

  it('keeps critical summary alerts visible when local alerts exceed the display limit', async () => {
    api.getSchedulingData.mockResolvedValue({
      ...buildCleanDashboardData(),
      staff: [],
      config: {
        ...MOCK_CONFIG,
        minimum_staffing: {
          early: { heads: 1, skill_points: 1 },
          late: { heads: 1, skill_points: 1 },
          night: { heads: 1, skill_points: 1 },
        },
      },
    });
    api.getDashboardSummary.mockResolvedValue({
      modules: {},
      alerts: [
        { type: 'error', module: 'incidents', message: 'CQC overdue', link: '/incidents', priority: 5 },
      ],
      weekActions: [],
    });

    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('CQC overdue')).toBeInTheDocument()
    );
  });

  it('shows a restricted state for staff self-service accounts and skips dashboard fetches', async () => {
    useData.mockReturnValue({
      canRead: module => module === 'scheduling' || module === 'payroll',
      canWrite: () => false,
      homeRole: 'staff_member',
      staffId: 'S1',
    });

    renderDashboard({ username: 'staff', role: 'staff_member' });

    await waitFor(() =>
      expect(screen.getByText('Dashboard is not available for staff self-service accounts.')).toBeInTheDocument()
    );
    expect(api.getSchedulingData).not.toHaveBeenCalled();
    expect(api.getDashboardSummary).not.toHaveBeenCalled();
  });
});
