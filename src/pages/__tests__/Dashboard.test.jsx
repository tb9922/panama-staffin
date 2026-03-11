import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { MOCK_SCHEDULING_DATA, MOCK_CONFIG, MOCK_STAFF } from '../../test/fixtures/schedulingData.js';
import Dashboard from '../Dashboard.jsx';

// ── Module mocks ────────────────────────────────────────────────────────────

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

// Stub heavy shared module to avoid Node import issues in jsdom
vi.mock('../../../shared/nmw.js', () => ({
  getMinimumWageRate: vi.fn(() => ({ rate: 12.21, label: 'NLW' })),
}));

// HR alerts — stub to return empty (separate DB tables)
vi.mock('../../lib/hr.js', () => ({
  getHrAlerts: vi.fn(() => []),
}));

// Finance alerts — stub
vi.mock('../../lib/finance.js', () => ({
  getFinanceAlertsForDashboard: vi.fn(() => []),
}));

// ── Imports after mocks ─────────────────────────────────────────────────────

import * as api from '../../lib/api.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderDashboard(userOverride = { username: 'admin', role: 'admin' }) {
  return renderWithProviders(<Dashboard />, { user: userOverride });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Dashboard', () => {
  beforeEach(() => {
    // Reset all mocks between tests
    vi.clearAllMocks();
    api.getCurrentHome.mockReturnValue('test-home');
    api.getSchedulingData.mockResolvedValue(MOCK_SCHEDULING_DATA);
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getHrStats.mockResolvedValue(null);
    api.getHrWarnings.mockResolvedValue([]);
    api.getFinanceAlerts.mockResolvedValue([]);
    api.getDashboardSummary.mockResolvedValue(null);
  });

  // 1. Loading state
  it('shows loading indicator initially', async () => {
    // Keep the promise pending so we see the loading state
    let resolve;
    api.getSchedulingData.mockReturnValue(new Promise(r => { resolve = r; }));

    renderDashboard();

    expect(screen.getByText('Loading dashboard...')).toBeInTheDocument();

    // Flush the pending promise so React finishes all state updates before teardown
    await act(async () => { resolve(MOCK_SCHEDULING_DATA); });
  });

  // 2. Home name and bed count appear after data loads
  it('renders home name and bed count after data loads', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText(MOCK_CONFIG.home_name)).toBeInTheDocument()
    );
    expect(screen.getByText(/30 beds/)).toBeInTheDocument();
  });

  // 3. Today's Coverage section
  it("renders Today's Coverage section", async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText("Today's Coverage — Live Status")).toBeInTheDocument()
    );

    // The three periods should appear as headings inside the gauge cards
    expect(screen.getByText('early')).toBeInTheDocument();
    expect(screen.getByText('late')).toBeInTheDocument();
    expect(screen.getByText('night')).toBeInTheDocument();
  });

  // 4. Staffing summary card
  it('renders the Staffing Summary KPI card', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('Staffing Summary')).toBeInTheDocument()
    );

    // KPI labels
    expect(screen.getByText('On Duty')).toBeInTheDocument();
    expect(screen.getByText('Sick')).toBeInTheDocument();
    expect(screen.getByText('Annual Leave')).toBeInTheDocument();
    expect(screen.getByText('Total Staff')).toBeInTheDocument();
  });

  // 5. Training compliance card
  it('renders the Training Compliance card', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('Training Compliance')).toBeInTheDocument()
    );
    // Compliance status badge: Compliant / At Risk / Non-Compliant
    const status = screen.queryByText('Compliant') ||
                   screen.queryByText('At Risk') ||
                   screen.queryByText('Non-Compliant');
    expect(status).toBeInTheDocument();
  });

  // 6. 28-Day Heatmap
  it('renders the 28-Day Coverage Heatmap section with 28 day buttons', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('28-Day Coverage Heatmap')).toBeInTheDocument()
    );
    // 28 day buttons rendered — the "D1" label is a div inside each button
    const dayLabels = screen.getAllByText(/^D\d+$/);
    expect(dayLabels).toHaveLength(28);
  });

  // 7. Alerts section
  it('renders the Alerts section', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('Alerts')).toBeInTheDocument()
    );
  });

  // 8. Admin sees Cost Summary with figures
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

  // 9. Viewer sees restricted Cost Summary
  it('viewer sees "Admin access required" in place of cost figures', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
    renderDashboard({ username: 'viewer', role: 'viewer' });

    await waitFor(() =>
      expect(screen.getByText('Cost Summary')).toBeInTheDocument()
    );
    expect(screen.getByText('Admin access required')).toBeInTheDocument();
    // Financial figures should not appear
    expect(screen.queryByText('This cycle:')).not.toBeInTheDocument();
  });

  // 10. API error surfaces an error message
  it('shows an error message when the scheduling API call fails', async () => {
    api.getSchedulingData.mockRejectedValue(new Error('Network timeout'));
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('Network timeout')).toBeInTheDocument()
    );
    // Loading spinner should be gone
    expect(screen.queryByText('Loading dashboard...')).not.toBeInTheDocument();
  });

  // 11. No home slug — dashboard stays empty (no API call made)
  it('does not call getSchedulingData when no home is selected', () => {
    api.getCurrentHome.mockReturnValue(null);
    renderDashboard();
    // Loading stays true because the effect returns early — no API call
    expect(api.getSchedulingData).not.toHaveBeenCalled();
  });

  // 12. "All clear" message when there are no alerts
  it('shows all-clear message when there are no alerts for the schedule', async () => {
    // Use a staff set that won't trigger any fatigue/NLW/accrual alerts:
    // single active staff member, well-paid, no overrides
    const cleanData = {
      ...MOCK_SCHEDULING_DATA,
      staff: [{
        id: 'S999', name: 'Safe Staff', role: 'Senior Carer', team: 'Day A',
        pref: 'EL', skill: 1.5, hourly_rate: 20.00, active: true,
        start_date: '2020-01-01', contract_hours: 37.5, wtr_opt_out: false,
        al_entitlement: null, al_carryover: 0, leaving_date: null,
        date_of_birth: null,
      }],
      overrides: {},
      config: {
        ...MOCK_CONFIG,
        // Minimums of 0 so single staff is always "covered"
        minimum_staffing: {
          early: { heads: 0, skill_points: 0 },
          late: { heads: 0, skill_points: 0 },
          night: { heads: 0, skill_points: 0 },
        },
        max_consecutive_days: 14,
      },
    };

    api.getSchedulingData.mockResolvedValue(cleanData);
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('All clear — full coverage this cycle')).toBeInTheDocument()
    );
  });

  // 13. Panama Staffing branding visible
  it('shows Print button in header area', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText(MOCK_CONFIG.home_name)).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
  });

  // 14. Action This Week card renders when weekActions present
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
    expect(screen.getByText('CQC overdue')).toBeInTheDocument();
    expect(screen.getByText('3 expired training')).toBeInTheDocument();
  });

  // 15. Action This Week card hidden when no weekActions
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

  // 16. Action This Week card hidden for viewer role
  it('does not render Action This Week card for viewer role', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
    api.getDashboardSummary.mockResolvedValue({
      modules: {},
      alerts: [],
      weekActions: [
        { type: 'error', module: 'incidents', message: 'CQC overdue', link: '/incidents', priority: 5 },
      ],
    });
    renderDashboard({ username: 'viewer', role: 'viewer' });

    await waitFor(() =>
      expect(screen.getByText('Alerts')).toBeInTheDocument()
    );
    expect(screen.queryByText('Action This Week')).not.toBeInTheDocument();
  });

  // 17. Heatmap legend is rendered
  it('renders the coverage heatmap legend', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText('Covered')).toBeInTheDocument()
    );
    expect(screen.getByText('Float/OT')).toBeInTheDocument();
    // "Agency" text appears in legend — use getAllByText as it may also appear elsewhere
    expect(screen.getAllByText('Agency').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Short/Unsafe')).toBeInTheDocument();
  });
});
