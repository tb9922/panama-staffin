import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RotationGrid from '../RotationGrid.jsx';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { MOCK_SCHEDULING_DATA } from '../../test/fixtures/schedulingData.js';
import { useData } from '../../contexts/DataContext.jsx';
import { formatDate } from '../../lib/rotation.js';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getSchedulingData: vi.fn(),
    upsertOverride: vi.fn(),
    deleteOverride: vi.fn(),
    bulkUpsertOverrides: vi.fn(),
    revertMonthOverrides: vi.fn(),
  };
});

vi.mock('../../lib/rotationAnalysis.js', () => ({
  generateHorizonRoster: vi.fn(() => ({
    assignments: [],
    totalCost: 0,
    residualGaps: 0,
    summary: {
      gapSlotsTotal: 0,
      gapSlotsFilled: 0,
      coverageFillPct: 1,
      floatShifts: 0,
      otShifts: 0,
      agencyShifts: 0,
      wtrWarnings: 0,
      totalCost: 0,
    },
  })),
}));

import * as api from '../../lib/api.js';
import { generateHorizonRoster } from '../../lib/rotationAnalysis.js';

beforeEach(() => {
  api.getSchedulingData.mockResolvedValue(MOCK_SCHEDULING_DATA);
});

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<RotationGrid />, {
    user: { username: 'admin', role: 'admin' },
  });
}

describe('RotationGrid', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('smoke test renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      const loading = document.querySelector('.animate-spin');
      const roster = screen.queryAllByText(/Roster/i);
      expect(loading !== null || roster.length > 0).toBe(true);
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getSchedulingData.mockRejectedValue(new Error('Network error'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('loads a centered scheduling window for the visible month', async () => {
    renderAdmin();
    await screen.findByRole('button', { name: 'Previous month' });
    const now = new Date();
    const monthDates = Array.from({ length: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate() }, (_, index) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), index + 1))
    );
    const anchor = monthDates[Math.floor(monthDates.length / 2)];
    expect(api.getSchedulingData).toHaveBeenCalledWith('test-home', {
      from: formatDate(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - 200))),
      to: formatDate(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() + 200))),
    });
  });

  it('shows the self-service rota view for staff self-service accounts', async () => {
    useData.mockReturnValue({
      canRead: () => true,
      canWrite: () => false,
      homeRole: 'staff_member',
      staffId: 'S001',
    });
    renderWithProviders(<RotationGrid />, {
      user: { username: 'staff', role: 'viewer' },
    });
    await waitFor(() => {
      expect(screen.getByText('My Rota')).toBeInTheDocument();
    });
    expect(screen.getByText('Working shifts')).toBeInTheDocument();
    expect(api.getSchedulingData).toHaveBeenCalled();
  });

  it('displays month header with month label and navigation arrows', async () => {
    renderAdmin();
    expect(await screen.findByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();
    expect(screen.getAllByText(/\w+\s\d{4}/).length).toBeGreaterThan(0);
  });

  it('displays active care staff names in the grid', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('Carol Davis')).toBeInTheDocument();
    expect(screen.queryByText('Dan Wilson')).not.toBeInTheDocument();
  });

  it('renders Print button', async () => {
    renderAdmin();
    expect(await screen.findByRole('button', { name: 'Print' }, { timeout: 20_000 })).toBeInTheDocument();
  }, 20_000);

  it('renders Export CSV button', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    });
  });

  it('shows absence and cover summary rows at the bottom of the grid', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText(/Absent/)).toBeInTheDocument();
      expect(screen.getByText(/Cover/)).toBeInTheDocument();
    });
  });

  it('admin can see clickable shift cells (buttons) in the grid', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    }, { timeout: 20_000 });

    const shiftButtons = screen.getAllByRole('button');
    expect(shiftButtons.length).toBeGreaterThan(5);
  }, 20_000);

  it('clicking a shift cell opens the shift editor modal for admin', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const shiftCells = document.querySelectorAll('button[title*="Click to change"]');
    expect(shiftCells.length).toBeGreaterThan(0);

    await user.click(shiftCells[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('Change shift to:')).toBeInTheDocument();
  });

  it('Revert All button opens confirmation modal', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Revert All/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Revert All/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText(/Remove all manual overrides/i)).toBeInTheDocument();
  });

  it('revert-all failure keeps the roster mounted and shows error inline', async () => {
    api.revertMonthOverrides.mockRejectedValueOnce(new Error('Injected Rotation Grid failure'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Revert All/i })).toBeInTheDocument();
    }, { timeout: 20_000 });

    fireEvent.click(screen.getByRole('button', { name: /Revert All/i }));

    const revertDialog = await screen.findByRole('dialog');
    fireEvent.click(within(revertDialog).getByRole('button', { name: /Revert All/i }));

    const confirmDialogs = await screen.findAllByRole('dialog');
    fireEvent.click(within(confirmDialogs[confirmDialogs.length - 1]).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(screen.getByText('Some roster actions could not be completed')).toBeInTheDocument();
    }, { timeout: 20_000 });
    expect(screen.getByText('Injected Rotation Grid failure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Auto-Roster/i })).toBeInTheDocument();
    expect(screen.queryByText('Unable to load the roster')).not.toBeInTheDocument();
  }, 30000);

  it('navigating to next month updates the month label', async () => {
    renderAdmin();
    await screen.findByRole('button', { name: 'Next month' }, { timeout: 20_000 });
    const monthLabelsBefore = screen.getAllByText(/\w+\s\d{4}/).map((node) => node.textContent);
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Current month' })).toBeInTheDocument();
    }, { timeout: 20_000 });
    const monthLabelsAfter = screen.getAllByText(/\w+\s\d{4}/).map((node) => node.textContent);
    expect(monthLabelsAfter).not.toEqual(monthLabelsBefore);
  }, 30000);

  it('team filter dropdown filters staff to selected team', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    expect(screen.getByText('Bob Jones')).toBeInTheDocument();

    const teamSelect = screen.getByDisplayValue('All Teams');
    await user.selectOptions(teamSelect, 'Day A');

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.queryByText('Carol Davis')).not.toBeInTheDocument();
  });

  it('Auto-Roster opens the review modal when gaps remain but no assignments are possible', async () => {
    generateHorizonRoster.mockReturnValue({
      assignments: [],
      totalCost: 0,
      residualGaps: 2,
      summary: {
        gapSlotsTotal: 2,
        gapSlotsFilled: 0,
        coverageFillPct: 0,
        floatShifts: 0,
        otShifts: 0,
        agencyShifts: 0,
        wtrWarnings: 0,
        totalCost: 0,
      },
    });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Auto-Roster/i })).toBeInTheDocument();
    }, { timeout: 20_000 });

    fireEvent.click(screen.getByRole('button', { name: /Auto-Roster/i }));

    await waitFor(() => {
      expect(screen.getByText(/2 residual gaps remain and no automatic cover could be proposed/i)).toBeInTheDocument();
    }, { timeout: 20_000 });
    expect(screen.queryByText(/Coverage is already fully met/i)).not.toBeInTheDocument();
  }, 30000);

  it('renders custom night rotation patterns in the main monthly grid', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T12:00:00Z'));

    const customSchedulingData = JSON.parse(JSON.stringify(MOCK_SCHEDULING_DATA));
    customSchedulingData.config.cycle_start_date = '2026-04-01';
    customSchedulingData.config.cycle_start_date_night = '2026-04-01';
    customSchedulingData.config.rotation_pattern_night = {
      teams: {
        A: [1, 1, 1, 1, 0, 0, 0, 0],
        B: [0, 0, 0, 0, 1, 1, 1, 1],
      },
    };
    customSchedulingData.staff.push({
      id: 'S005',
      name: 'Nina Patel',
      role: 'Night Senior',
      team: 'Night B',
      pref: 'N',
      skill: 1,
      hourly_rate: 13.5,
      active: true,
      start_date: '2024-01-01',
      contract_hours: 36,
      wtr_opt_out: false,
      al_entitlement: null,
      al_carryover: 0,
      leaving_date: null,
    });
    api.getSchedulingData.mockResolvedValueOnce(customSchedulingData);

    renderAdmin();
    vi.useRealTimers();

    const carolRow = (await screen.findByText('Carol Davis')).closest('tr');
    expect(carolRow).not.toBeNull();

    const shiftButtons = within(carolRow).getAllByRole('button');
    expect(shiftButtons[0]).toHaveTextContent('N');
    expect(shiftButtons[3]).toHaveTextContent('N');
    expect(shiftButtons[4]).toHaveTextContent('-');
    expect(shiftButtons[14]).toHaveTextContent('-');
    expect(shiftButtons[15]).toHaveTextContent('-');
    expect(shiftButtons[16]).toHaveTextContent('N');
  });
});
