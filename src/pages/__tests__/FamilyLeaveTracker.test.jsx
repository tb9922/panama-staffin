import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import FamilyLeaveTracker from '../FamilyLeaveTracker.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHrFamilyLeave: vi.fn(),
    createHrFamilyLeave: vi.fn(),
    updateHrFamilyLeave: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([
      { id: 'S010', name: 'Alice Brown', role: 'Carer', active: true },
    ]),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

const MOCK_MATERNITY = {
  id: 'FL-001',
  staff_id: 'S010',
  leave_type: 'maternity',
  start_date: '2026-04-01',
  end_date: '2027-03-31',
  status: 'active',
  expected_return: '2027-04-01',
  actual_return: '',
  kit_days_used: 3,
  pay_type: 'SMP',
  version: 1,
};

const MOCK_PATERNITY = {
  id: 'FL-002',
  staff_id: 'S011',
  leave_type: 'paternity',
  start_date: '2026-05-10',
  end_date: '2026-05-24',
  status: 'planned',
  expected_return: '2026-05-25',
  actual_return: '',
  kit_days_used: 0,
  pay_type: 'SPP',
  version: 1,
};

const MOCK_RESPONSE = { rows: [MOCK_MATERNITY], total: 1 };
const EMPTY_RESPONSE = { rows: [], total: 0 };

function renderAdmin() {
  return renderWithProviders(<FamilyLeaveTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getCurrentHome.mockReturnValue('test-home');
  api.getHrFamilyLeave.mockResolvedValue(MOCK_RESPONSE);
  api.getHrStaffList.mockResolvedValue([
    { id: 'S010', name: 'Alice Brown', role: 'Carer', active: true },
  ]);
});

describe('FamilyLeaveTracker', () => {
  it('smoke test - renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.queryByText(/Loading family leave/i) || screen.queryByText(/Family Leave/i)).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getHrFamilyLeave.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading family leave data...')).toBeInTheDocument();
  });

  it('shows retryable error state when API call fails', async () => {
    api.getHrFamilyLeave.mockRejectedValue(new Error('Permission denied'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Permission denied')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('displays page heading after load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Family Leave' })).toBeInTheDocument();
    });
  });

  it('displays leave record row with staff ID and dates', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('S010')).toBeInTheDocument();
    });
    expect(screen.getByText('2026-04-01')).toBeInTheDocument();
  });

  it('shows Protected badge for maternity leave', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Protected')).toBeInTheDocument();
    });
  });

  it('does not show Protected badge for paternity leave', async () => {
    api.getHrFamilyLeave.mockResolvedValue({ rows: [MOCK_PATERNITY], total: 1 });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('S011')).toBeInTheDocument();
    });
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('shows action-first empty state when no records exist', async () => {
    api.getHrFamilyLeave.mockResolvedValue(EMPTY_RESPONSE);
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('No family leave records yet')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('button', { name: /New Leave Record/i }).length).toBeGreaterThan(1);
  });

  it('shows a success notice after creating a leave record', async () => {
    const user = userEvent.setup();
    api.createHrFamilyLeave.mockResolvedValue({ id: 'FL-003' });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Leave Record/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /New Leave Record/i }));
    await user.selectOptions(screen.getByLabelText(/Staff Member/i), 'S010');
    await user.type(screen.getByLabelText(/Start Date/i), '2026-04-20');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createHrFamilyLeave).toHaveBeenCalledWith('test-home', expect.objectContaining({
        staff_id: 'S010',
        start_date: '2026-04-20',
      }));
    });

    await waitFor(() => {
      expect(screen.getByText('Family leave record added.')).toBeInTheDocument();
    });
  });

  it('uses a select for pay type in the modal', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FamilyLeaveTracker />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Leave Record/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /New Leave Record/i }));

    expect(screen.getByLabelText('Pay Type')).toHaveDisplayValue('None');
    expect(screen.getByRole('option', { name: 'SMP' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ShPP' })).toBeInTheDocument();
  });
});
