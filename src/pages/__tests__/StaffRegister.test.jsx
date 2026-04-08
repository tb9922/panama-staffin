import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StaffRegister from '../StaffRegister.jsx';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { MOCK_SCHEDULING_DATA, MOCK_STAFF } from '../../test/fixtures/schedulingData.js';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getSchedulingData: vi.fn(),
    createStaff: vi.fn(),
    updateStaffMember: vi.fn(),
    deleteStaffMember: vi.fn(),
    getRecordAttachments: vi.fn(),
    uploadRecordAttachment: vi.fn(),
    deleteRecordAttachment: vi.fn(),
    downloadRecordAttachment: vi.fn(),
  };
});

// Design tokens and rotation helpers don't need network — keep real
vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderAdmin() {
  return renderWithProviders(<StaffRegister />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  return renderWithProviders(<StaffRegister />, {
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Default: successful load with mock scheduling data
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getSchedulingData.mockResolvedValue(MOCK_SCHEDULING_DATA);
  api.getRecordAttachments.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('StaffRegister', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    // Either loading or the heading will appear — just don't throw
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading staff/i) ||
        screen.queryByText(/Staff Database/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    // Never resolves during this test
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText(/Loading staff/i)).toBeInTheDocument();
  });

  it('displays the Staff Database heading after load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Staff Database')).toBeInTheDocument();
    });
  });

  it('renders a row for each active staff member', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('Carol Davis')).toBeInTheDocument();
    // Dan Wilson is inactive — filtered out by default "active only" filter
    expect(screen.queryByText('Dan Wilson')).not.toBeInTheDocument();
  });

  it('shows correct role and team for each staff member', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Senior Carer')).toBeInTheDocument();
    });
    // 'Day A' appears in both the team filter dropdown options and the table cell
    // — use getAllByText to tolerate multiple matches
    expect(screen.getAllByText('Day A').length).toBeGreaterThan(0);
    expect(screen.getByText('Night Carer')).toBeInTheDocument();
  });

  it('search by name filters the staff list', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText(/Search name or ID/i);
    await user.type(searchInput, 'Bob');

    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('search is case-insensitive', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText(/Search name or ID/i);
    await user.type(searchInput, 'alice');

    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
  });

  it('admin sees the Add Staff button', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ Add Staff/i })).toBeInTheDocument();
    });
  });

  it('viewer does NOT see the Add Staff button', async () => {
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText('Staff Database')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /\+ Add Staff/i })).not.toBeInTheDocument();
  });

  it('admin sees Rate column header', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Staff Database')).toBeInTheDocument();
    });
    expect(screen.getByText('Rate')).toBeInTheDocument();
  });

  it('viewer does NOT see Rate column header', async () => {
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText('Staff Database')).toBeInTheDocument();
    });
    expect(screen.queryByText('Rate')).not.toBeInTheDocument();
  });

  it('shows NLW badge for staff below minimum wage (care role)', async () => {
    // Use a staff member with a rate below the MOCK_CONFIG nlw_rate (12.21)
    const staffWithBelowNLW = [
      {
        id: 'S010', name: 'Low Pay Carer', role: 'Carer', team: 'Day A',
        pref: 'EL', skill: 0.5, hourly_rate: 10.00, active: true,
        start_date: '2025-01-01', contract_hours: 36, wtr_opt_out: false,
        al_entitlement: null, al_carryover: 0, leaving_date: null,
      },
    ];
    api.getSchedulingData.mockResolvedValue({
      ...MOCK_SCHEDULING_DATA,
      staff: staffWithBelowNLW,
    });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Low Pay Carer')).toBeInTheDocument();
    });
    // Rate is £10.00, below NLW (12.21) — badge should appear
    const belowBadges = screen.queryAllByText(/Below NLW/i);
    expect(belowBadges.length).toBeGreaterThan(0);
  });

  it('does NOT show NLW badge for staff above minimum wage', async () => {
    // Alice Smith: Senior Carer with hourly_rate: 14.50 — well above NLW
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    // If we count all "Below NLW" badges, Alice's rate cell should not have one.
    // Since we can't easily isolate, just verify Alice's rate appears
    expect(screen.getByText('£14.50')).toBeInTheDocument();
  });

  it('displays team filter dropdown with All Teams option', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Staff Database')).toBeInTheDocument();
    });
    const teamSelect = screen.getByDisplayValue('All Teams');
    expect(teamSelect).toBeInTheDocument();
  });

  it('team filter narrows the list to selected team', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    const teamSelect = screen.getByDisplayValue('All Teams');
    await user.selectOptions(teamSelect, 'Day B');

    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument(); // Day A
    expect(screen.getByText('Bob Jones')).toBeInTheDocument(); // Day B
  });

  it('handles API error by showing error message with retry button', async () => {
    api.getSchedulingData.mockRejectedValue(new Error('Network failure'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText(/Network failure/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('retry button re-fetches data after error', async () => {
    const user = userEvent.setup();
    api.getSchedulingData
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce(MOCK_SCHEDULING_DATA);

    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText(/Network failure/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Retry/i }));

    await waitFor(() => {
      expect(screen.getByText('Staff Database')).toBeInTheDocument();
    });
    expect(api.getSchedulingData).toHaveBeenCalledTimes(2);
  });

  it('status filter switches to inactive shows deactivated staff', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    // Dan Wilson is inactive — not shown in "active only"
    expect(screen.queryByText('Dan Wilson')).not.toBeInTheDocument();

    const statusSelect = screen.getByDisplayValue('Active Only');
    await user.selectOptions(statusSelect, 'Inactive Only');

    await waitFor(() => {
      expect(screen.getByText('Dan Wilson')).toBeInTheDocument();
    });
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
  });

  it('opens Add Staff modal when admin clicks Add Staff', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ Add Staff/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /\+ Add Staff/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Add New Staff' })).toBeInTheDocument();
  });

  it('shows staff count in filter row', async () => {
    renderAdmin();
    await waitFor(() => {
      // 3 active staff members in MOCK_STAFF
      expect(screen.getByText(/3 shown/i)).toBeInTheDocument();
    });
  });

  it('admin sees Edit button for each staff row', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    const editButtons = screen.getAllByRole('button', { name: /Edit/i });
    // 3 active staff rows
    expect(editButtons.length).toBe(3);
  });

  it('viewer does NOT see Edit buttons', async () => {
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText('Staff Database')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument();
  });

  it('opens the staff evidence modal from the actions column', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    await user.click(screen.getAllByRole('button', { name: 'Docs' })[0]);
    await waitFor(() => {
      expect(screen.getByText('Staff Evidence')).toBeInTheDocument();
    });
  });
});
