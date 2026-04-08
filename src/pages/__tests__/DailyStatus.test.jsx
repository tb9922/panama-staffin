import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DailyStatus from '../DailyStatus.jsx';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { MOCK_SCHEDULING_DATA } from '../../test/fixtures/schedulingData.js';
import { useData } from '../../contexts/DataContext.jsx';
import { addDays, formatDate, parseDate } from '../../lib/rotation.js';

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
    upsertDayNote: vi.fn(),
    updateStaffMember: vi.fn(),
    getRecordAttachments: vi.fn(),
    uploadRecordAttachment: vi.fn(),
    deleteRecordAttachment: vi.fn(),
    downloadRecordAttachment: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

// Render at a fixed date so the dateStr and dayName are stable
const FIXED_DATE = '2026-03-08';

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<DailyStatus />, {
    route: `/day/${FIXED_DATE}`,
    path: '/day/:date',
    user: { username: 'admin', role: 'admin' },
  });
}


// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getSchedulingData.mockResolvedValue(MOCK_SCHEDULING_DATA);
  api.upsertOverride.mockResolvedValue({});
  api.deleteOverride.mockResolvedValue({});
  api.upsertDayNote.mockResolvedValue({});
  api.updateStaffMember.mockResolvedValue({});
  api.getRecordAttachments.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('DailyStatus', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading/i) ||
        screen.queryByText(/Coverage/i)
      ).not.toBeNull();
    });
  });

  it('shows loading spinner while data is fetching', () => {
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getSchedulingData.mockRejectedValue(new Error('Failed to load schedule'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Failed to load schedule')).toBeInTheDocument();
    });
    // Retry link should appear alongside the error
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('loads a centered scheduling window around the viewed date', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(api.getSchedulingData).toHaveBeenCalled();
    });
    const expectedDate = parseDate(FIXED_DATE);
    expect(api.getSchedulingData).toHaveBeenCalledWith('test-home', {
      from: formatDate(addDays(expectedDate, -200)),
      to: formatDate(addDays(expectedDate, 200)),
    });
  });

  it('shows a restricted state for staff self-service accounts', async () => {
    useData.mockReturnValue({
      canRead: () => true,
      canWrite: () => false,
      homeRole: 'staff_member',
      staffId: 'S001',
    });
    renderWithProviders(<DailyStatus />, {
      route: `/day/${FIXED_DATE}`,
      path: '/day/:date',
      user: { username: 'staff', role: 'viewer' },
    });
    await waitFor(() => {
      expect(screen.getByText('Daily Status is not available for staff self-service accounts.')).toBeInTheDocument();
    });
    expect(api.getSchedulingData).not.toHaveBeenCalled();
  });

  it('displays the date in the page heading', async () => {
    renderAdmin();
    await waitFor(() => {
      // The heading shows a long-form date like "Sunday, 8 March 2026"
      // It appears in both the print header p and the visible h1
      const matches = screen.getAllByText(/8 March 2026/i);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('renders Previous and Next day navigation buttons', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText(/Coverage/i)).toBeInTheDocument();
    });
    // Arrow buttons for day navigation
    const prevBtn = screen.getByRole('button', { name: /←/i });
    const nextBtn = screen.getByRole('button', { name: /→/i });
    expect(prevBtn).toBeInTheDocument();
    expect(nextBtn).toBeInTheDocument();
  });

  it('renders Today navigation button', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    });
  });

  it('displays the Coverage panel with early/late/night periods', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Coverage')).toBeInTheDocument();
    });
    // The coverage panel shows period labels
    expect(screen.getByText('early')).toBeInTheDocument();
    expect(screen.getByText('late')).toBeInTheDocument();
    expect(screen.getByText('night')).toBeInTheDocument();
  });

  it('displays staff list sections — Early, Late, Night, Sick, Annual Leave', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText(/Early \(/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Late \(/)).toBeInTheDocument();
    expect(screen.getByText(/Night \(/)).toBeInTheDocument();
    expect(screen.getByText(/Sick \(/)).toBeInTheDocument();
    expect(screen.getByText(/Annual Leave \(/)).toBeInTheDocument();
  });

  it('admin sees quick-action buttons (+Sick, +AL, +OT, +Agency)', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('+Sick')).toBeInTheDocument();
    });
    expect(screen.getByText('+AL')).toBeInTheDocument();
    expect(screen.getByText('+OT')).toBeInTheDocument();
    expect(screen.getByText('+Agency')).toBeInTheDocument();
  });

  it('admin sees quick-action buttons (+Training, +Sleep In, Swap)', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('+Training')).toBeInTheDocument();
    });
    expect(screen.getByText('+Sleep In')).toBeInTheDocument();
    expect(screen.getByText('Swap')).toBeInTheDocument();
  });

  it('clicking +Sick opens the Mark Sick modal', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('+Sick')).toBeInTheDocument();
    });

    await user.click(screen.getByText('+Sick'));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Mark Sick' })).toBeInTheDocument();
  });

  it('clicking a shift badge opens the change-status modal and saves a new shift', async () => {
    const user = userEvent.setup();
    renderAdmin();
    let shiftButtons = [];
    await waitFor(() => {
      shiftButtons = screen.getAllByRole('button', { name: 'Change shift for Alice Smith' });
      expect(shiftButtons.length).toBeGreaterThan(0);
    });

    await user.click(shiftButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Change Status' })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(api.getRecordAttachments).toHaveBeenCalledWith('schedule_override', `${FIXED_DATE}__S001`);
    });

    await user.selectOptions(screen.getByRole('combobox'), 'L');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(api.upsertOverride).toHaveBeenCalledWith(
        'test-home',
        expect.objectContaining({
          date: FIXED_DATE,
          staffId: 'S001',
          shift: 'L',
          reason: 'Manual shift edit',
          source: 'manual',
        }),
        expect.any(Object),
      );
    });
  });

  it('displays Handover Notes textarea', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Handover Notes')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText(/Add notes for handover/i)).toBeInTheDocument();
  });

  it('displays Available Cover section', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText(/Available Cover/)).toBeInTheDocument();
    });
  });

  it('displays cost breakdown with Total label', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Costs')).toBeInTheDocument();
    });
    expect(screen.getByText('Total:')).toBeInTheDocument();
    expect(screen.getByText('Base:')).toBeInTheDocument();
  });
});
