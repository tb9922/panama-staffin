import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { useData } from '../../contexts/DataContext.jsx';
import PortfolioDashboard from '../PortfolioDashboard.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin', isPlatformAdmin: true })),
    logout: vi.fn(),
    getPortfolioKpis: vi.fn(),
    getPortfolioBoardPack: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

let switchHome;

function portfolioPayload(overrides = {}) {
  return {
    homes: [
      {
        home_id: 1,
        home_slug: 'amberwood',
        home_name: 'Amberwood',
        staffing: { planned_shift_slots_7d: 56, gaps_7d: 4, gaps_per_100_planned_shifts: 7.1 },
        training: { compliance_pct: 100, expired: 0 },
        manager_actions: { open: 0, overdue: 0 },
        incidents: { open: 1, rate_per_resident_month: 0 },
        complaints: { open: 0, rate_per_resident_month: 0 },
        cqc_evidence: {
          open_gaps: 3,
          overall: { band: 'not_ready', label: 'Heuristic: Significant Gaps', badge: 'red' },
        },
        maintenance: { overdue: 0, due_30d: 0 },
        agency: { shifts_28d: 0, emergency_override_pct: 0 },
        occupancy: { pct: 100, available: 0, hospital_hold: 0 },
        outcomes: { falls_28d: 0, infections_28d: 0 },
        rag: {
          overall: 'red',
          staffing: 'amber',
          training: 'green',
          manager_actions: 'green',
          incidents: 'green',
          complaints: 'green',
          cqc_evidence: 'red',
          maintenance: 'green',
          agency: 'green',
          occupancy: 'green',
          outcomes: 'green',
        },
        ...overrides,
      },
    ],
  };
}

describe('PortfolioDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    switchHome = vi.fn();
    useData.mockReturnValue({
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'platform_admin',
      staffId: null,
      homes: [{ id: 'amberwood', name: 'Amberwood', roleId: 'platform_admin' }],
      isPlatformAdmin: true,
      switchHome,
    });
    api.getPortfolioKpis.mockResolvedValue(portfolioPayload());
    api.getPortfolioBoardPack.mockResolvedValue({ homes: [] });
  });

  it('renders object-shaped CQC readiness as human copy', async () => {
    renderWithProviders(<PortfolioDashboard />, {
      route: '/portfolio',
      user: { username: 'admin', role: 'admin', isPlatformAdmin: true },
    });

    await waitFor(() => expect(screen.getByText('Portfolio Dashboard')).toBeInTheDocument());
    expect(screen.getByText('Significant Gaps readiness')).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drill into Amberwood' })).toBeInTheDocument();
  });

  it('does not show zero-summary empty state after KPI load failure', async () => {
    api.getPortfolioKpis.mockRejectedValueOnce(new Error('Portfolio API unavailable'));

    renderWithProviders(<PortfolioDashboard />, {
      route: '/portfolio',
      user: { username: 'admin', role: 'admin', isPlatformAdmin: true },
    });

    await waitFor(() => expect(screen.getByText('Portfolio API unavailable')).toBeInTheDocument());
    expect(screen.queryByText('No homes available')).not.toBeInTheDocument();
    expect(screen.queryByText('Red homes')).not.toBeInTheDocument();
  });

  it('makes unknown KPI coverage explicit and routes the fix action through the selected home', async () => {
    const user = userEvent.setup();
    api.getPortfolioKpis.mockResolvedValueOnce(portfolioPayload({
      data_quality: {
        unknown_count: 2,
        unknown_signals: [
          {
            key: 'training',
            label: 'Training',
            reason: 'Mandatory training requirements have not been configured or no required records exist.',
            fix: 'Configure role-required training and upload current certificates.',
            route: '/training',
          },
          {
            key: 'maintenance',
            label: 'Maintenance',
            reason: 'Maintenance/certificate status is not available.',
            fix: 'Review maintenance checks and statutory certificate records.',
            route: '/maintenance',
          },
        ],
      },
      rag: {
        overall: 'unknown',
        staffing: 'green',
        training: 'unknown',
        manager_actions: 'green',
        incidents: 'green',
        complaints: 'green',
        cqc_evidence: 'green',
        maintenance: 'unknown',
        agency: 'green',
        occupancy: 'green',
        outcomes: 'green',
      },
    }));

    renderWithProviders(<PortfolioDashboard />, {
      route: '/portfolio',
      user: { username: 'admin', role: 'admin', isPlatformAdmin: true },
    });

    await waitFor(() => expect(screen.getByText('Unknown KPI coverage')).toBeInTheDocument());
    expect(screen.getByText('2 missing KPI signals need owner review before board sign-off.')).toBeInTheDocument();
    expect(screen.getByText('2 unknown domains')).toBeInTheDocument();
    expect(screen.getAllByText('Mandatory training requirements have not been configured or no required records exist.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Configure role-required training and upload current certificates.').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Fix Training coverage for Amberwood: Configure role-required training and upload current certificates.' }));

    expect(switchHome).toHaveBeenCalledWith('amberwood');
  });

  it('adds direct drilldown affordances for red metric signals', async () => {
    const user = userEvent.setup();

    renderWithProviders(<PortfolioDashboard />, {
      route: '/portfolio',
      user: { username: 'admin', role: 'admin', isPlatformAdmin: true },
    });

    await waitFor(() => expect(screen.getByText('Portfolio Dashboard')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Open evidence for Amberwood CQC' }));

    expect(switchHome).toHaveBeenCalledWith('amberwood');
  });

  it('hides metric fix actions when the assigned role lacks module access', async () => {
    useData.mockReturnValue({
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'viewer',
      staffId: null,
      homes: [{ id: 'amberwood', name: 'Amberwood', roleId: 'viewer' }],
      isPlatformAdmin: false,
      switchHome,
    });

    renderWithProviders(<PortfolioDashboard />, {
      route: '/portfolio',
      user: { username: 'viewer', role: 'viewer', isPlatformAdmin: false },
    });

    await waitFor(() => expect(screen.getByText('Portfolio Dashboard')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Open evidence for Amberwood CQC' })).not.toBeInTheDocument();
  });
});
