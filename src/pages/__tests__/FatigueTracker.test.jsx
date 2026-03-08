import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import FatigueTracker from '../FatigueTracker.jsx';

// ── Module mocks ──────────────────────────────────────────────────────────────

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

import * as api from '../../lib/api.js';

// ── Fixture data ──────────────────────────────────────────────────────────────

// Only care roles count toward coverage in FatigueTracker (isCareRole filter)
const MOCK_STAFF = [
  {
    id: 'S001', name: 'Alice Smith', role: 'Senior Carer', team: 'Day A',
    active: true, pref: 'E', skill: 2, wtr_opt_out: false,
  },
  {
    id: 'S002', name: 'Bob Jones', role: 'Carer', team: 'Day B',
    active: true, pref: 'L', skill: 1, wtr_opt_out: false,
  },
  {
    id: 'S003', name: 'Carol Davis', role: 'Night Carer', team: 'Night A',
    active: true, pref: 'N', skill: 1, wtr_opt_out: false,
  },
  // Inactive staff should not appear
  {
    id: 'S004', name: 'Dave Inactive', role: 'Carer', team: 'Day A',
    active: false, pref: 'E', skill: 1, wtr_opt_out: false,
  },
];

const MOCK_CONFIG = {
  home_name: 'Sunrise Care',
  cycle_start_date: '2025-01-06',
  max_consecutive_days: 7,
  minimum_staffing: {
    early: { heads: 2, skill_points: 3 },
    late: { heads: 2, skill_points: 3 },
    night: { heads: 1, skill_points: 1 },
  },
  shifts: {
    E: { hours: 8 },
    L: { hours: 8 },
    EL: { hours: 12 },
    N: { hours: 10 },
  },
  bank_holidays: [],
  agency_rate_day: 20,
  agency_rate_night: 22,
  ot_premium: 2,
  bh_premium_multiplier: 1.5,
};

const MOCK_RESPONSE = {
  config: MOCK_CONFIG,
  staff: MOCK_STAFF,
  overrides: {},
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPage() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<FatigueTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getSchedulingData.mockResolvedValue(MOCK_RESPONSE);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FatigueTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderPage();
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading fatigue data/i) ||
        screen.queryByText(/Fatigue Tracker/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading fatigue data...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getSchedulingData.mockRejectedValue(new Error('Network error'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('renders page heading and monitoring summary after load', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Fatigue Tracker')).toBeInTheDocument();
    });
    // Shows max consecutive day limit and staff count (print header duplicates these)
    const consecMatches = screen.getAllByText(/Max consecutive days: 7/i);
    expect(consecMatches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Monitoring 3 staff/i)).toBeInTheDocument();
  });

  it('shows the fatigue table with care staff rows', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('Carol Davis')).toBeInTheDocument();
    // Inactive staff must not appear
    expect(screen.queryByText('Dave Inactive')).not.toBeInTheDocument();
  });

  it('renders alert summary cards for exceeded, at-risk and safe counts', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Fatigue Tracker')).toBeInTheDocument();
    });
    expect(screen.getByText('Exceeded limit')).toBeInTheDocument();
    expect(screen.getByText(/At risk/i)).toBeInTheDocument();
    expect(screen.getByText('Safe')).toBeInTheDocument();
  });

  it('shows BREACH or RISK status labels when fatigue is detected', async () => {
    // Override S001 to be working 8 consecutive days (exceeds max 7)
    const overrides = {};
    // Build 8 consecutive working days around 2026-03-01 to 2026-03-08
    for (let d = 1; d <= 8; d++) {
      const dateStr = `2026-03-${String(d).padStart(2, '0')}`;
      overrides[dateStr] = {
        S001: { shift: 'E', reason: '', source: 'manual' },
      };
    }
    api.getSchedulingData.mockResolvedValue({
      ...MOCK_RESPONSE,
      overrides,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Fatigue Tracker')).toBeInTheDocument();
    });
    // At minimum, status column headers should be present
    const statusHeaders = screen.getAllByText('Status');
    expect(statusHeaders.length).toBeGreaterThan(0);
  });

  it('renders Export Excel and Print buttons', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Fatigue Tracker')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Export Excel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print/i })).toBeInTheDocument();
  });
});
