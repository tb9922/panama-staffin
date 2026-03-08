import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import SickPayTracker from '../SickPayTracker.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getSchedulingData: vi.fn(),
    getSickPeriods: vi.fn(),
    createSickPeriod: vi.fn(),
    updateSickPeriod: vi.fn(),
    getSSPConfig: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../components/StaffPicker.jsx', () => ({
  default: ({ value, onChange, label }) => (
    <div data-testid="staff-picker">
      {label && <label>{label}</label>}
      <select value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">All</option>
        <option value="S001">Alice Smith</option>
      </select>
    </div>
  ),
}));

import * as api from '../../lib/api.js';

const MOCK_SSP_CONFIG = {
  weekly_rate: '116.75',
  waiting_days: 0,
  max_weeks: 28,
  lel_weekly: null,
};

const MOCK_SCHED_DATA = {
  staff: [
    { id: 'S001', name: 'Alice Smith', role: 'Carer', team: 'Day A', active: true },
    { id: 'S002', name: 'Bob Jones', role: 'Senior Carer', team: 'Day B', active: true },
  ],
  overrides: {},
  config: { cycle_start_date: '2025-01-06' },
};

const MOCK_PERIODS = [
  {
    id: 'sp-1', staff_id: 'S001', start_date: '2026-03-01', end_date: null,
    qualifying_days_per_week: 5, waiting_days_served: 0, ssp_weeks_paid: '0.00',
    fit_note_received: false, fit_note_date: null, notes: '',
  },
  {
    id: 'sp-2', staff_id: 'S002', start_date: '2026-01-10', end_date: '2026-01-20',
    qualifying_days_per_week: 5, waiting_days_served: 3, ssp_weeks_paid: '1.14',
    fit_note_received: true, fit_note_date: '2026-01-17', notes: 'Flu',
  },
];

function setupMocks(periods = MOCK_PERIODS) {
  api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
  api.getSickPeriods.mockResolvedValue(periods);
  api.getSSPConfig.mockResolvedValue(MOCK_SSP_CONFIG);
}

describe('SickPayTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
  });

  it('smoke test - renders without crashing', async () => {
    setupMocks();
    renderWithProviders(<SickPayTracker />);
    await waitFor(() =>
      expect(screen.getByText('Sick Pay Tracker')).toBeInTheDocument()
    );
  });

  it('shows loading state initially', () => {
    api.getSickPeriods.mockReturnValue(new Promise(() => {}));
    api.getSSPConfig.mockReturnValue(new Promise(() => {}));
    api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
    renderWithProviders(<SickPayTracker />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
    api.getSickPeriods.mockRejectedValue(new Error('Network error'));
    api.getSSPConfig.mockRejectedValue(new Error('Network error'));
    renderWithProviders(<SickPayTracker />);
    await waitFor(() =>
      expect(screen.getByText('Network error')).toBeInTheDocument()
    );
  });

  it('renders sick periods table with correct data', async () => {
    setupMocks();
    renderWithProviders(<SickPayTracker />);
    // Wait for Bob Jones — unique to the table (not in StaffPicker mock), confirms schedData loaded
    await waitFor(() =>
      expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    );
    // "Alice Smith" appears in both the table and the mocked StaffPicker dropdown
    expect(screen.getAllByText('Alice Smith').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2026-03-01')).toBeInTheDocument();
    expect(screen.getByText('2026-01-10')).toBeInTheDocument();
  });

  it('renders SSP config summary cards', async () => {
    setupMocks();
    renderWithProviders(<SickPayTracker />);
    await waitFor(() =>
      expect(screen.getByText('SSP weekly rate')).toBeInTheDocument()
    );
    expect(screen.getByText('Waiting days')).toBeInTheDocument();
    expect(screen.getByText('Max duration')).toBeInTheDocument();
    expect(screen.getByText('28 weeks')).toBeInTheDocument();
  });

  it('shows open/closed status badges', async () => {
    setupMocks();
    renderWithProviders(<SickPayTracker />);
    // Wait for table data using a date that only appears in the table
    await waitFor(() =>
      expect(screen.getByText('2026-03-01')).toBeInTheDocument()
    );
    // Open period for Alice (End Date column "Open" + Status badge "Open"), Closed for Bob
    const openBadges = screen.getAllByText('Open');
    expect(openBadges.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0);
  });

  it('admin sees "Record Sick Period" button', async () => {
    setupMocks();
    renderWithProviders(<SickPayTracker />);
    await waitFor(() =>
      expect(screen.getByText('Sick Pay Tracker')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Record Sick Period' })).toBeInTheDocument();
  });

  it('viewer does not see "Record Sick Period" button or Update buttons', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
    setupMocks();
    renderWithProviders(<SickPayTracker />, { user: { username: 'viewer', role: 'viewer' } });
    await waitFor(() =>
      expect(screen.getByText('Sick Pay Tracker')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Record Sick Period' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();
  });

  it('shows empty state when no sick periods exist', async () => {
    setupMocks([]);
    renderWithProviders(<SickPayTracker />);
    await waitFor(() =>
      expect(screen.getByText('Sick Pay Tracker')).toBeInTheDocument()
    );
    expect(screen.getByText(/No sick periods recorded/)).toBeInTheDocument();
  });
});
