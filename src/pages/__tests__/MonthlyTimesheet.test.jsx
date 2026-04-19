import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import MonthlyTimesheet from '../MonthlyTimesheet.jsx';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getSchedulingData: vi.fn(),
    getTimesheetPeriod: vi.fn(),
    batchUpsertTimesheets: vi.fn(),
    approveTimesheetRange: vi.fn(),
    upsertTimesheet: vi.fn(),
    approveTimesheet: vi.fn(),
    disputeTimesheet: vi.fn(),
    upsertTimesheetHourAdjustment: vi.fn(),
    deleteTimesheetHourAdjustment: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([]),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../lib/payroll.js', () => ({
  snapToShift: vi.fn((...args) => ({
    snapped: args[1],
    applied: false,
    savedMinutes: 0,
  })),
  calculatePayableHours: vi.fn(() => 8.0),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import * as api from '../../lib/api.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_SCHED_DATA = {
  staff: [
    { id: 'S001', name: 'Alice Smith', role: 'Senior Carer', team: 'Day A', pref: 'EL', skill: 1.5, active: true, contract_hours: 36 },
    { id: 'S002', name: 'Bob Jones', role: 'Carer', team: 'Day B', pref: 'EL', skill: 0.5, active: true, contract_hours: 36 },
  ],
  overrides: {},
  hour_adjustments: {},
  config: {
    cycle_start_date: '2025-01-06',
    shifts: {
      E: { start: '07:00', end: '15:00', hours: 8 },
      L: { start: '14:00', end: '22:00', hours: 8 },
      EL: { start: '07:00', end: '19:00', hours: 12 },
      N: { start: '21:00', end: '07:00', hours: 10 },
    },
    bank_holidays: [],
  },
};

const MOCK_ENTRIES = [
  {
    id: 'ts-1',
    staff_id: 'S001',
    date: '2026-03-02',
    scheduled_start: '07:00',
    scheduled_end: '19:00',
    actual_start: '07:05',
    actual_end: '19:10',
    snapped_start: '07:00',
    snapped_end: '19:00',
    snap_applied: true,
    snap_minutes_saved: 15,
    break_minutes: 30,
    payable_hours: 11.5,
    status: 'pending',
    notes: '',
  },
  {
    id: 'ts-2',
    staff_id: 'S001',
    date: '2026-03-03',
    scheduled_start: '07:00',
    scheduled_end: '19:00',
    actual_start: '07:00',
    actual_end: '19:00',
    snapped_start: '07:00',
    snapped_end: '19:00',
    snap_applied: false,
    snap_minutes_saved: 0,
    break_minutes: 30,
    payable_hours: 11.5,
    status: 'approved',
    notes: '',
  },
];

function setupMocks(entries = MOCK_ENTRIES) {
  api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
  api.getTimesheetPeriod.mockResolvedValue(entries);
}

function renderAdmin(entries) {
  setupMocks(entries);
  return renderWithProviders(<MonthlyTimesheet />, {
    route: '/payroll/monthly-timesheet/S001',
    path: '/payroll/monthly-timesheet/:staffId?',
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer(entries) {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  setupMocks(entries);
  return renderWithProviders(<MonthlyTimesheet />, {
    route: '/payroll/monthly-timesheet/S001',
    path: '/payroll/monthly-timesheet/:staffId?',
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

function currentMonthDate(day = 2) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-${String(day).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MonthlyTimesheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
  });

  it('smoke test -- renders without crashing', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Monthly Timesheet')).toBeInTheDocument()
    );
  });

  it('shows loading state while scheduling data loads', () => {
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    api.getTimesheetPeriod.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<MonthlyTimesheet />);
    expect(screen.getByText('Loading monthly timesheet data...')).toBeInTheDocument();
  });

  it('loads scheduling data for the visible payroll month only', async () => {
    renderAdmin();
    await screen.findByText('Monthly Timesheet');
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    const monthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    const monthEnd = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate()).padStart(2, '0')}`;
    expect(api.getSchedulingData).toHaveBeenCalledWith('test-home', {
      from: monthStart,
      to: monthEnd,
    });
  });

  it('stays on loading screen when scheduling data fails', async () => {
    api.getSchedulingData.mockRejectedValue(new Error('Server down'));
    api.getTimesheetPeriod.mockResolvedValue([]);
    renderWithProviders(<MonthlyTimesheet />);
    // schedData stays null, so the component keeps showing the loading fallback
    await waitFor(() =>
      expect(screen.getByText('Loading monthly timesheet data...')).toBeInTheDocument()
    );
  });

  it('renders summary cards after data loads', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Scheduled')).toBeInTheDocument()
    );
    expect(screen.getByText('Worked')).toBeInTheDocument();
    expect(screen.getByText('Worked Variance')).toBeInTheDocument();
    // 'Approved' appears in both summary card label and status badge
    expect(screen.getAllByText('Approved').length).toBeGreaterThanOrEqual(1);
  });

  it('renders table with expected column headers', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: 'Date' })).toBeInTheDocument()
    );
    expect(screen.getByRole('columnheader', { name: 'Day' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Roster' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
  });

  it('shows bulk action buttons for admin', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Monthly Timesheet')).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Confirm.*as Scheduled/i })).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: /Approve.*Pending/i })).toBeInTheDocument();
  });

  it('hides bulk action buttons and Actions column for viewer', async () => {
    renderViewer();
    await waitFor(() =>
      expect(screen.getByText('Monthly Timesheet')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: /Confirm.*as Scheduled/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve.*Pending/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('shows staff picker with active staff options', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Monthly Timesheet')).toBeInTheDocument()
    );
    // The staff selector should contain staff options
    const select = screen.getByDisplayValue(/S001/);
    expect(select).toBeInTheDocument();
  });

  it('lets a manager resolve a shortfall with hourly annual leave', async () => {
    const dateStr = currentMonthDate(2);
    api.getSchedulingData.mockResolvedValue({
      ...MOCK_SCHED_DATA,
      overrides: {
        [dateStr]: {
          S001: { shift: 'EL' },
        },
      },
    });
    api.getTimesheetPeriod.mockResolvedValue([
      {
        ...MOCK_ENTRIES[0],
        date: dateStr,
        payable_hours: 11.5,
      },
    ]);
    api.upsertTimesheetHourAdjustment.mockResolvedValue({
      staff_id: 'S001',
      date: dateStr,
      kind: 'annual_leave',
      hours: 0.5,
      note: 'Left early for appointment',
    });

    renderWithProviders(<MonthlyTimesheet />, {
      route: '/payroll/monthly-timesheet/S001',
      path: '/payroll/monthly-timesheet/:staffId?',
      user: { username: 'admin', role: 'admin' },
    });

    await screen.findByText('Monthly Timesheet');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Adjust' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Adjust' }));
    await screen.findByText('Resolve Shortfall');

    fireEvent.change(screen.getByLabelText('Hours to apply'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Left early for appointment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(api.upsertTimesheetHourAdjustment).toHaveBeenCalledWith('test-home', {
        staff_id: 'S001',
        date: dateStr,
        kind: 'annual_leave',
        hours: 0.5,
        note: 'Left early for appointment',
        source: 'timesheet_shortfall',
      });
    });
  });

  it('lets a manager remove an existing hourly shortfall adjustment', async () => {
    const dateStr = currentMonthDate(2);
    api.getSchedulingData.mockResolvedValue({
      ...MOCK_SCHED_DATA,
      hour_adjustments: {
        [dateStr]: {
          S001: { kind: 'annual_leave', hours: 0.5, note: 'Existing adjustment' },
        },
      },
      overrides: {
        [dateStr]: {
          S001: { shift: 'EL' },
        },
      },
    });
    api.getTimesheetPeriod.mockResolvedValue([
      {
        ...MOCK_ENTRIES[0],
        date: dateStr,
        payable_hours: 11.5,
      },
    ]);
    api.deleteTimesheetHourAdjustment.mockResolvedValue({ ok: true });

    renderWithProviders(<MonthlyTimesheet />, {
      route: '/payroll/monthly-timesheet/S001',
      path: '/payroll/monthly-timesheet/:staffId?',
      user: { username: 'admin', role: 'admin' },
    });

    await screen.findByText('Monthly Timesheet');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Adjust' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Adjust' }));
    await screen.findByText('Resolve Shortfall');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(api.deleteTimesheetHourAdjustment).toHaveBeenCalledWith('test-home', 'S001', dateStr);
    });
  });
});
