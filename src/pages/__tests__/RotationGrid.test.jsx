import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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

import * as api from '../../lib/api.js';

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 8)));
    renderAdmin();
    await vi.runAllTimersAsync();
    const anchor = new Date(Date.UTC(2026, 2, 16));
    expect(api.getSchedulingData).toHaveBeenCalledWith('test-home', {
      from: formatDate(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - 200))),
      to: formatDate(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() + 200))),
    });
  });

  it('shows a restricted state for staff self-service accounts', async () => {
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
      expect(screen.getByText('Roster management is not available for staff self-service accounts.')).toBeInTheDocument();
    });
    expect(api.getSchedulingData).not.toHaveBeenCalled();
  });

  it('displays month header with month label and navigation arrows', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Roster')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();

    const allText = document.body.innerText || document.body.textContent;
    expect(allText).toMatch(/\d{4}/);
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
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
    });
  });

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
    });

    const shiftButtons = screen.getAllByRole('button');
    expect(shiftButtons.length).toBeGreaterThan(5);
  });

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

  it('navigating to next month updates the month label', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Roster')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Current month' })).toBeInTheDocument();
    });
  }, 15000);

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
});
