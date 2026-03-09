import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import HrDashboard from '../HrDashboard.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHrStats: vi.fn(),
    getHrWarnings: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

const MOCK_STATS = {
  open_disciplinary: 2,
  open_grievance: 1,
  open_performance: 0,
  pending_flex: 3,
  active_warnings: 4,
};

const MOCK_WARNINGS = [
  {
    staff_id: 'S001',
    staff_name: 'Alice Smith',
    type: 'Disciplinary',
    outcome: 'first_written',
    expiry_date: '2026-12-01',
    case_id: 'DISC-001',
  },
  {
    staff_id: 'S002',
    staff_name: 'Bob Jones',
    type: 'Disciplinary',
    outcome: 'final_written',
    expiry_date: '2027-06-01',
    case_id: 'DISC-002',
  },
];

describe('HrDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getCurrentHome.mockReturnValue('test-home');
    api.getHrStats.mockResolvedValue(MOCK_STATS);
    api.getHrWarnings.mockResolvedValue(MOCK_WARNINGS);
  });

  it('shows loading state initially', () => {
    api.getHrStats.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<HrDashboard />);
    expect(screen.getByText(/loading hr data/i)).toBeInTheDocument();
  });

  it('renders page heading after load', async () => {
    renderWithProviders(<HrDashboard />);
    await waitFor(() => expect(screen.getByText('HR & People')).toBeInTheDocument());
  });

  it('shows overview KPI cards with stats', async () => {
    renderWithProviders(<HrDashboard />);
    await waitFor(() => expect(screen.getByText('Open Disciplinary')).toBeInTheDocument());
    expect(screen.getByText('Open Grievance')).toBeInTheDocument();
    expect(screen.getByText('Active Performance')).toBeInTheDocument();
    expect(screen.getByText('Pending Flex Working')).toBeInTheDocument();
  });

  it('shows correct stat values from API', async () => {
    renderWithProviders(<HrDashboard />);
    await waitFor(() => expect(screen.getByText('Open Disciplinary')).toBeInTheDocument());
    // 2 open disciplinaries, 1 grievance, 3 pending flex — use getAllByText for numbers that may appear elsewhere
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
  });

  it('shows tabs for Overview and Warning Register', async () => {
    renderWithProviders(<HrDashboard />);
    await waitFor(() => expect(screen.getByText('HR & People')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Warning Register' })).toBeInTheDocument();
  });

  it('switches to Warning Register tab and shows warnings', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HrDashboard />);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Warning Register' })).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: 'Warning Register' }));
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('DISC-001')).toBeInTheDocument();
  });

  it('shows empty warning state when no warnings', async () => {
    api.getHrWarnings.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithProviders(<HrDashboard />);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Warning Register' })).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: 'Warning Register' }));
    expect(screen.getByText('No active warnings')).toBeInTheDocument();
  });

  it('shows error banner on API failure', async () => {
    api.getHrStats.mockRejectedValue(new Error('Stats unavailable'));
    renderWithProviders(<HrDashboard />);
    await waitFor(() => expect(screen.getByText('Stats unavailable')).toBeInTheDocument());
  });
});
