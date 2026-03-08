import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import TimesheetManager from '../TimesheetManager.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getTimesheets: vi.fn(),
    upsertTimesheet: vi.fn(),
    approveTimesheet: vi.fn(),
    bulkApproveTimesheets: vi.fn(),
    getSchedulingData: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../lib/payroll.js', () => ({
  snapToShift: vi.fn((scheduled, actual, window, enabled) => ({
    snapped: actual,
    applied: false,
    savedMinutes: 0,
  })),
  calculatePayableHours: vi.fn(() => 8.0),
}));

vi.mock('../../hooks/useDirtyGuard', () => ({
  default: vi.fn(),
}));

import * as api from '../../lib/api.js';

const MOCK_SCHED_DATA = {
  staff: [
    { id: 'S001', name: 'Alice Smith', role: 'Senior Carer', team: 'Day A', pref: 'EL', skill: 1.5, active: true, contract_hours: 36 },
  ],
  overrides: {},
  config: {
    cycle_start_date: '2025-01-06',
    shifts: { E: { start: '07:00', end: '15:00', hours: 8 }, L: { start: '14:00', end: '22:00', hours: 8 } },
    bank_holidays: [],
  },
};

const MOCK_ENTRIES = [
  {
    id: 'ts-1',
    staff_id: 'S001',
    date: '2026-03-08',
    actual_start: '07:05',
    actual_end: '15:10',
    snapped_start: '07:00',
    snapped_end: '15:00',
    snap_applied: true,
    snap_minutes_saved: 15,
    break_minutes: 30,
    payable_hours: 7.5,
    status: 'pending',
    notes: '',
  },
];

describe('TimesheetManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
    api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
    api.getTimesheets.mockResolvedValue(MOCK_ENTRIES);
    api.upsertTimesheet.mockResolvedValue({});
    api.approveTimesheet.mockResolvedValue({});
    api.bulkApproveTimesheets.mockResolvedValue({});
  });

  it('renders page heading', async () => {
    renderWithProviders(<TimesheetManager />);
    expect(screen.getByText('Timesheets')).toBeInTheDocument();
  });

  it('shows loading state initially', async () => {
    let resolve;
    api.getTimesheets.mockReturnValue(new Promise(r => { resolve = r; }));
    renderWithProviders(<TimesheetManager />);
    expect(screen.getByText('Loading timesheets…')).toBeInTheDocument();
    await act(async () => { resolve(MOCK_ENTRIES); });
  });

  it('shows error message on API failure', async () => {
    api.getTimesheets.mockRejectedValue(new Error('Server unavailable'));
    renderWithProviders(<TimesheetManager />);
    await waitFor(() => expect(screen.getByText('Server unavailable')).toBeInTheDocument());
  });

  it('renders summary stat cards', async () => {
    renderWithProviders(<TimesheetManager />);
    // Cards include Scheduled, Approved, Pending, Snap Savings
    await waitFor(() => expect(screen.getByText('Scheduled')).toBeInTheDocument());
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Snap Savings')).toBeInTheDocument();
  });

  it('shows bulk action buttons for admin', async () => {
    renderWithProviders(<TimesheetManager />);
    await waitFor(() => expect(screen.getByText('Scheduled')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /confirm all as scheduled/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve all pending/i })).toBeInTheDocument();
  });

  it('hides bulk action buttons for viewers', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
    renderWithProviders(<TimesheetManager />, { user: { username: 'viewer', role: 'viewer' } });
    await waitFor(() => expect(screen.getByText('Scheduled')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /confirm all as scheduled/i })).not.toBeInTheDocument();
  });

  it('shows date navigation controls', async () => {
    renderWithProviders(<TimesheetManager />);
    await waitFor(() => expect(screen.getByText('Scheduled')).toBeInTheDocument());
    // Date input for selecting day
    expect(screen.getByDisplayValue(/\d{4}-\d{2}-\d{2}/)).toBeInTheDocument();
  });
});
