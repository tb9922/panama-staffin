import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
    useData.mockReturnValue({
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'platform_admin',
      staffId: null,
      switchHome: vi.fn(),
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
  });
});
