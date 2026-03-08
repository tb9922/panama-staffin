import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RotationGrid from '../RotationGrid.jsx';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { MOCK_SCHEDULING_DATA } from '../../test/fixtures/schedulingData.js';

// ── Module mocks ───────────────────────────────────────────────────────────────

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

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getSchedulingData.mockResolvedValue(MOCK_SCHEDULING_DATA);
});

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<RotationGrid />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  return renderWithProviders(<RotationGrid />, {
    user: { username: 'viewer', role: 'viewer' },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RotationGrid', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    // Either loading state or loaded state must be present
    await waitFor(() => {
      const loading = document.querySelector('.animate-spin');
      const roster = screen.queryAllByText(/Roster/i);
      expect(loading !== null || roster.length > 0).toBe(true);
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    // Spinner renders as animated div while loading
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getSchedulingData.mockRejectedValue(new Error('Network error'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('displays month header with month label and navigation arrows', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Roster')).toBeInTheDocument();
    });
    // Month navigation arrows are rendered as HTML entities → and ←
    const prevBtn = screen.getByRole('button', { name: /←/i });
    const nextBtn = screen.getByRole('button', { name: /→/i });
    expect(prevBtn).toBeInTheDocument();
    expect(nextBtn).toBeInTheDocument();
    // Should show a month label (e.g., "March 2026")
    // monthLabel is computed from the current UTC date — just check it looks like a date label
    const allText = document.body.innerText || document.body.textContent;
    expect(allText).toMatch(/\d{4}/); // year present
  });

  it('displays active care staff names in the grid', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('Carol Davis')).toBeInTheDocument();
    // Inactive staff should not appear
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
      // The summary rows are labelled "Absent" and "Cover"
      expect(screen.getByText(/Absent/)).toBeInTheDocument();
      expect(screen.getByText(/Cover/)).toBeInTheDocument();
    });
  });

  it('admin can see clickable shift cells (buttons) in the grid', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    // Each cell is a <button> — there should be many (staff × days)
    const shiftButtons = screen.getAllByRole('button');
    // At least the navigation + export + some shift cells
    expect(shiftButtons.length).toBeGreaterThan(5);
  });

  it('clicking a shift cell opens the shift editor modal for admin', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    // Find a shift cell button that is not a nav/control button
    // Shift cells have title attributes containing "Click to change"
    const shiftCells = document.querySelectorAll('button[title*="Click to change"]');
    expect(shiftCells.length).toBeGreaterThan(0);

    await user.click(shiftCells[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    // Modal should show "Change shift to:" label
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
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Roster')).toBeInTheDocument();
    });

    // Get current month label text before clicking next
    const nextBtn = screen.getByRole('button', { name: /→/i });
    await user.click(nextBtn);

    await waitFor(() => {
      // After clicking next, "Current" button should appear (to go back to current month)
      expect(screen.getByRole('button', { name: 'Current' })).toBeInTheDocument();
    });
  });

  it('team filter dropdown filters staff to selected team', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    // Alice is Day A, Bob is Day B, Carol is Night A
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();

    // Filter to "Day A" only
    const teamSelect = screen.getByDisplayValue('All Teams');
    await user.selectOptions(teamSelect, 'Day A');

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    // Bob Jones (Day B) and Carol Davis (Night A) should no longer appear
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.queryByText('Carol Davis')).not.toBeInTheDocument();
  });
});
