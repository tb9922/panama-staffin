import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import AbsenceManager from '../AbsenceManager.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getAbsenceSummary: vi.fn(),
    getStaffAbsence: vi.fn(),
    getHrRtwInterviews: vi.fn(),
    createHrRtwInterview: vi.fn(),
    updateHrRtwInterview: vi.fn(),
    getHrOhReferrals: vi.fn(),
    createHrOhReferral: vi.fn(),
    updateHrOhReferral: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([
      { id: 'S001', name: 'Alice Carer', role: 'Carer', active: true },
    ]),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../hooks/useDirtyGuard.js', () => ({
  default: vi.fn(),
}));

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

const MOCK_SUMMARY = [
  { staff_id: 'S001', spells: 3, days: 12, score: 108, trigger_level: 'informal' },
  { staff_id: 'S002', spells: 5, days: 20, score: 500, trigger_level: 'stage_2' },
];

const MOCK_RTW = {
  rows: [
    {
      id: 1, staff_id: 'S001', absence_start_date: '2026-02-01', absence_end_date: '2026-02-05',
      rtw_date: '2026-02-06', conducted_by: 'Manager A', fit_for_work: true,
      absence_reason: 'Cold/flu', version: 1,
    },
  ],
  total: 1,
};

const MOCK_OH = {
  rows: [
    {
      id: 1, staff_id: 'S002', referral_date: '2026-01-15', reason: 'Back pain',
      provider: 'Occupational Health Ltd', report_received: false, version: 1,
    },
  ],
  total: 1,
};

function setupMocks() {
  api.getAbsenceSummary.mockResolvedValue(MOCK_SUMMARY);
  api.getHrRtwInterviews.mockResolvedValue(MOCK_RTW);
  api.getHrOhReferrals.mockResolvedValue(MOCK_OH);
  api.getHrStaffList.mockResolvedValue([
    { id: 'S001', name: 'Alice Carer', role: 'Carer', active: true },
  ]);
}

function renderPage() {
  setupMocks();
  return renderWithProviders(<AbsenceManager />, {
    user: { username: 'admin', role: 'admin' },
  });
}

describe('AbsenceManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  });

  it('smoke test — renders without crashing', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('Absence Management')).toBeInTheDocument()
    );
  });

  it('shows loading text initially', () => {
    api.getAbsenceSummary.mockReturnValue(new Promise(() => {}));
    api.getHrRtwInterviews.mockReturnValue(new Promise(() => {}));
    api.getHrOhReferrals.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<AbsenceManager />);
    expect(screen.getByText('Loading absence data...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getAbsenceSummary.mockRejectedValue(new Error('Database error'));
    api.getHrRtwInterviews.mockRejectedValue(new Error('Database error'));
    api.getHrOhReferrals.mockRejectedValue(new Error('Database error'));
    renderWithProviders(<AbsenceManager />);
    await waitFor(() =>
      expect(screen.getByText('Database error')).toBeInTheDocument()
    );
  });

  it('renders Bradford Scores tab with staff data', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('S001')).toBeInTheDocument()
    );
    expect(screen.getByText('S002')).toBeInTheDocument();
    // Bradford scores are rendered in table
    expect(screen.getByText('108')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
  });

  it('renders three tab buttons', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Bradford Scores' })).toBeInTheDocument()
    );
    expect(screen.getByRole('tab', { name: 'RTW Interviews' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'OH Referrals' })).toBeInTheDocument();
  });

  it('switches to RTW Interviews tab and shows data', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'RTW Interviews' })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('tab', { name: 'RTW Interviews' }));
    expect(screen.getByText('S001')).toBeInTheDocument();
    expect(screen.getByText('Manager A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New RTW Interview' })).toBeInTheDocument();
  });

  it('switches to OH Referrals tab and shows data', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'OH Referrals' })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('tab', { name: 'OH Referrals' }));
    expect(screen.getByText('S002')).toBeInTheDocument();
    expect(screen.getByText('Back pain')).toBeInTheDocument();
    expect(screen.getByText('Occupational Health Ltd')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New OH Referral' })).toBeInTheDocument();
  });

  it('shows "No absence data" when summary is empty', async () => {
    api.getAbsenceSummary.mockResolvedValue([]);
    api.getHrRtwInterviews.mockResolvedValue({ rows: [], total: 0 });
    api.getHrOhReferrals.mockResolvedValue({ rows: [], total: 0 });
    renderWithProviders(<AbsenceManager />);
    await waitFor(() =>
      expect(screen.getByText('No absence data')).toBeInTheDocument()
    );
  });

  it('requires Conducted By before saving a new RTW interview', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'RTW Interviews' })).toBeInTheDocument()
    );

    await user.click(screen.getByRole('tab', { name: 'RTW Interviews' }));
    await user.click(screen.getByRole('button', { name: 'New RTW Interview' }));
    await user.selectOptions(screen.getByLabelText('Staff Member'), 'S001');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('Conducted By is required')).toBeInTheDocument();
    expect(api.createHrRtwInterview).not.toHaveBeenCalled();
  });
});
