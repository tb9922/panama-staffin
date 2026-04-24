import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    getRecordAttachments: vi.fn(),
    uploadRecordAttachment: vi.fn(),
    deleteRecordAttachment: vi.fn(),
    downloadRecordAttachment: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../components/StaffPicker.jsx', () => ({
  default: ({ value, onChange, label }) => (
    <div data-testid="staff-picker">
      {label && <label>{label}</label>}
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        <option value="S001">Alice Smith</option>
      </select>
    </div>
  ),
}));

import * as api from '../../lib/api.js';

const MOCK_SSP_CONFIG = [
  {
    effective_from: '2025-04-06',
    weekly_rate: '118.75',
    waiting_days: 3,
    max_weeks: 28,
    lel_weekly: '125.00',
  },
  {
    effective_from: '2026-04-06',
    weekly_rate: '123.25',
    waiting_days: 0,
    max_weeks: 28,
    lel_weekly: null,
  },
];

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
    id: 'sp-1',
    staff_id: 'S001',
    start_date: '2026-03-01',
    end_date: null,
    qualifying_days_per_week: 5,
    waiting_days_served: 0,
    ssp_weeks_paid: '0.00',
    fit_note_received: false,
    fit_note_date: null,
    notes: '',
  },
  {
    id: 'sp-2',
    staff_id: 'S002',
    start_date: '2026-01-10',
    end_date: '2026-01-20',
    qualifying_days_per_week: 5,
    waiting_days_served: 3,
    ssp_weeks_paid: '1.14',
    fit_note_received: true,
    fit_note_date: '2026-01-17',
    notes: 'Flu',
  },
];

function setupMocks(periods = MOCK_PERIODS) {
  api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
  api.getSickPeriods.mockResolvedValue(periods);
  api.getSSPConfig.mockResolvedValue(MOCK_SSP_CONFIG);
  api.getRecordAttachments.mockResolvedValue([]);
}

describe('SickPayTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
    api.getRecordAttachments.mockResolvedValue([]);
  });

  it('smoke test - renders without crashing', async () => {
    setupMocks();
    renderWithProviders(<SickPayTracker />);
    await waitFor(() =>
      expect(screen.getByText('Sick Pay Tracker')).toBeInTheDocument(),
    );
  });

  it('shows loading state initially', () => {
    api.getSickPeriods.mockReturnValue(new Promise(() => {}));
    api.getSSPConfig.mockReturnValue(new Promise(() => {}));
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<SickPayTracker />);
    expect(screen.getByText('Loading sick pay records...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
    api.getSickPeriods.mockRejectedValue(new Error('Network error'));
    api.getSSPConfig.mockRejectedValue(new Error('Network error'));
    renderWithProviders(<SickPayTracker />);
    await waitFor(() =>
      expect(screen.getByText('Network error')).toBeInTheDocument(),
    );
  });

  it('renders sick periods table with correct data', async () => {
    setupMocks();
    renderWithProviders(<SickPayTracker />);
    await waitFor(() =>
      expect(screen.getByText('Bob Jones')).toBeInTheDocument(),
    );
    expect(screen.getAllByText('Alice Smith').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2026-03-01')).toBeInTheDocument();
    expect(screen.getByText('2026-01-10')).toBeInTheDocument();
  });

  it('renders SSP config summary cards from the applicable config row', async () => {
    setupMocks();
    renderWithProviders(<SickPayTracker />);
    await waitFor(() =>
      expect(screen.getByText('SSP weekly rate')).toBeInTheDocument(),
    );
    expect(screen.getByText('Waiting days')).toBeInTheDocument();
    expect(screen.getByText('Max duration')).toBeInTheDocument();
    expect(screen.getByText('£123.25')).toBeInTheDocument();
    expect(screen.getByText('28 weeks')).toBeInTheDocument();
  });

  it('shows open and closed status badges', async () => {
    setupMocks();
    renderWithProviders(<SickPayTracker />);
    await waitFor(() =>
      expect(screen.getByText('2026-03-01')).toBeInTheDocument(),
    );
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0);
  });

  it('admin sees "Record Sick Period" button', async () => {
    setupMocks();
    renderWithProviders(<SickPayTracker />);
    await waitFor(() =>
      expect(screen.getByText('Sick Pay Tracker')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Record Sick Period' })).toBeInTheDocument();
  });

  it('viewer does not see "Record Sick Period" button or Update buttons', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
    setupMocks();
    renderWithProviders(<SickPayTracker />, { user: { username: 'viewer', role: 'viewer' }, canWrite: false });
    await waitFor(() =>
      expect(screen.getByText('Sick Pay Tracker')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Record Sick Period' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();
  });

  it('only offers valid linked periods for the selected staff member and start date', async () => {
    const user = userEvent.setup();
    setupMocks([
      {
        id: 'recent-s001',
        staff_id: 'S001',
        start_date: '2026-01-20',
        end_date: '2026-02-10',
        qualifying_days_per_week: 5,
        waiting_days_served: 2,
        ssp_weeks_paid: '0.43',
        fit_note_received: true,
        fit_note_date: '2026-02-02',
        notes: '',
      },
      {
        id: 'stale-s001',
        staff_id: 'S001',
        start_date: '2025-10-01',
        end_date: '2025-12-01',
        qualifying_days_per_week: 5,
        waiting_days_served: 3,
        ssp_weeks_paid: '1.00',
        fit_note_received: true,
        fit_note_date: '2025-10-08',
        notes: '',
      },
      {
        id: 'recent-s002',
        staff_id: 'S002',
        start_date: '2026-02-01',
        end_date: '2026-02-28',
        qualifying_days_per_week: 5,
        waiting_days_served: 1,
        ssp_weeks_paid: '0.86',
        fit_note_received: true,
        fit_note_date: '2026-02-08',
        notes: '',
      },
    ]);

    renderWithProviders(<SickPayTracker />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Record Sick Period' })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Record Sick Period' }));

    const staffLabel = screen.getAllByText('Staff Member').find((node) => node.tagName === 'LABEL');
    const startDateLabel = screen.getAllByText('Start Date').find((node) => node.tagName === 'LABEL');
    const linkedPeriodLabel = screen.getAllByText('Linked to Previous Period (optional)').find((node) => node.tagName === 'LABEL');

    const staffSelect = staffLabel.parentElement.querySelector('select');
    const startDateInput = startDateLabel.parentElement.querySelector('input');
    const linkSelect = linkedPeriodLabel.parentElement.querySelector('select');

    expect(linkSelect).toBeDisabled();

    await user.selectOptions(staffSelect, 'S001');
    await user.type(startDateInput, '2026-03-20');

    expect(linkSelect).not.toBeDisabled();
    const optionTexts = Array.from(linkSelect.options).map((option) => option.textContent);

    expect(optionTexts).toEqual([
      'None — new sick period',
      expect.stringContaining('2026-01-20'),
    ]);
  });

  it('shows empty state when no sick periods exist', async () => {
    setupMocks([]);
    renderWithProviders(<SickPayTracker />);
    await waitFor(() =>
      expect(screen.getByText('Sick Pay Tracker')).toBeInTheDocument(),
    );
    expect(screen.getByText(/No sick periods recorded/)).toBeInTheDocument();
  });

  it('does not raise a fit-note alert on exactly 7 calendar days', async () => {
    setupMocks([
      {
        id: 'sp-3',
        staff_id: 'S001',
        start_date: '2026-04-01',
        end_date: '2026-04-07',
        qualifying_days_per_week: 5,
        waiting_days_served: 0,
        ssp_weeks_paid: '0.00',
        fit_note_received: false,
        fit_note_date: null,
        notes: '',
      },
    ]);
    renderWithProviders(<SickPayTracker />);
    await waitFor(() =>
      expect(screen.getByText('Sick Pay Tracker')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Fit note required for/)).not.toBeInTheDocument();
  });

  it('includes the current version when saving an update', async () => {
    const user = userEvent.setup();
    setupMocks([
      {
        ...MOCK_PERIODS[0],
        version: 7,
      },
    ]);
    api.updateSickPeriod.mockResolvedValue({});

    renderWithProviders(<SickPayTracker />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Update' }));
    await user.type(
      screen.getByPlaceholderText('e.g. Fit note received, return to work interview completed'),
      'Closed after GP review',
    );
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(api.updateSickPeriod).toHaveBeenCalledWith(
        'test-home',
        'sp-1',
        expect.objectContaining({
          _version: 7,
          notes: 'Closed after GP review',
        }),
      ),
    );
  });
});
