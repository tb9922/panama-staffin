import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import SickTrends from '../SickTrends.jsx';

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

// Only care roles appear (isCareRole filter)
const MOCK_STAFF = [
  {
    id: 'S001', name: 'Alice Smith', role: 'Senior Carer', team: 'Day A',
    active: true, pref: 'E', skill: 2,
  },
  {
    id: 'S002', name: 'Bob Jones', role: 'Carer', team: 'Day B',
    active: true, pref: 'L', skill: 1,
  },
  // Inactive — should be excluded
  {
    id: 'S003', name: 'Carol Inactive', role: 'Carer', team: 'Day A',
    active: false, pref: 'E', skill: 1,
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

// Alice has two sick days in March 2026 (within the 6-month window ending now)
const MOCK_OVERRIDES_WITH_SICK = {
  '2026-03-04': {
    S001: { shift: 'SICK', reason: 'Cold', source: 'manual' },
  },
  '2026-03-05': {
    S001: { shift: 'SICK', reason: 'Cold', source: 'manual' },
  },
};

const MOCK_RESPONSE = {
  config: MOCK_CONFIG,
  staff: MOCK_STAFF,
  overrides: MOCK_OVERRIDES_WITH_SICK,
};

const MOCK_RESPONSE_NO_SICK = {
  config: MOCK_CONFIG,
  staff: MOCK_STAFF,
  overrides: {},
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<SickTrends />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  return renderWithProviders(<SickTrends />, {
    user: { username: 'viewer', role: 'viewer' },
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getSchedulingData.mockResolvedValue(MOCK_RESPONSE);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SickTrends', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading sick trend data/i) ||
        screen.queryByText(/Sick Trend Analytics/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading sick trend data...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getSchedulingData.mockRejectedValue(new Error('Failed to load'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });
  });

  it('renders page heading and subtitle after successful load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Sick Trend Analytics')).toBeInTheDocument();
    });
    // "Last 6 months" appears in print header and subtitle — use getAllByText
    const last6Matches = screen.getAllByText(/Last 6 months/i);
    expect(last6Matches.length).toBeGreaterThanOrEqual(1);
    // Staff count in subtitle (only in the visible subtitle paragraph)
    expect(screen.getByText(/2 staff monitored/i)).toBeInTheDocument();
  });

  it('renders KPI summary cards', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Sick Trend Analytics')).toBeInTheDocument();
    });
    expect(screen.getByText('Total Sick Days')).toBeInTheDocument();
    expect(screen.getByText('Avg / Month')).toBeInTheDocument();
    expect(screen.getByText('Staff Affected')).toBeInTheDocument();
    expect(screen.getByText('High Absence')).toBeInTheDocument();
  });

  it('shows care staff rows in the sick trends table', async () => {
    renderAdmin();
    await waitFor(() => {
      // Admin sees real names
      expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Bob Jones').length).toBeGreaterThan(0);
    // Inactive staff should not appear
    expect(screen.queryByText('Carol Inactive')).not.toBeInTheDocument();
  });

  it('shows "No sick days recorded" when there is no sick data', async () => {
    api.getSchedulingData.mockResolvedValue(MOCK_RESPONSE_NO_SICK);
    renderAdmin();
    // Wait for the page to load first
    await waitFor(() => {
      expect(screen.getByText('Sick Trend Analytics')).toBeInTheDocument();
    });
    // "No sick days recorded" appears in the Highest Absence panel
    // and in the sick day log empty state
    const noSickMatches = screen.getAllByText(/No sick days recorded/i);
    expect(noSickMatches.length).toBeGreaterThanOrEqual(1);
  });

  it('viewer sees anonymised names instead of real staff names', async () => {
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText('Sick Trend Analytics')).toBeInTheDocument();
    });
    // Real names should not appear for viewers
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    // Anonymised labels should appear
    expect(screen.getAllByText(/Staff Member/i).length).toBeGreaterThan(0);
  });

  it('sick log filters dropdown is present for staff and month', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Sick Trend Analytics')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('All Staff')).toBeInTheDocument();
    expect(screen.getByDisplayValue('All Months')).toBeInTheDocument();
  });
});
