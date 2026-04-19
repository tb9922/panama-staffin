import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { MOCK_SCHEDULING_DATA, MOCK_STAFF, MOCK_CONFIG } from '../../test/fixtures/schedulingData.js';
import AnnualLeave from '../AnnualLeave.jsx';
import { useData } from '../../contexts/DataContext.jsx';
import { addDays, formatDate, parseDate } from '../../lib/rotation.js';
import { bulkUpsertOverrides, deleteOverride } from '../../lib/api.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/api.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getSchedulingData: vi.fn(),
    bulkUpsertOverrides: vi.fn(),
    deleteOverride: vi.fn(),
  };
});

vi.mock('../../lib/accrual.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getAccrualSummary: vi.fn(),
    getLeaveYear: vi.fn(),
  };
});

vi.mock('../../lib/rotation.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    formatDate: actual.formatDate,
    addDays: actual.addDays,
    parseDate: actual.parseDate,
    isCareRole: actual.isCareRole,
    getScheduledShift: vi.fn(() => 'EL'),
    getCycleDay: vi.fn(() => 0),
    countALOnDate: vi.fn(() => 0),
    getALDeductionHours: vi.fn(() => 12),
  };
});

vi.mock('../../lib/rotationAnalysis.js', () => ({
  generateCoverPlan: vi.fn(() => ({ assignments: [], totalCost: 0, residualGaps: 0 })),
}));

vi.mock('../../hooks/useLiveDate.js', () => ({
  useLiveDate: vi.fn(() => '2026-03-08'),
}));

vi.mock('../../lib/design.js', async (importActual) => {
  const actual = await importActual();
  return actual;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { getSchedulingData } from '../../lib/api.js';
import { getAccrualSummary, getLeaveYear } from '../../lib/accrual.js';
import { generateCoverPlan } from '../../lib/rotationAnalysis.js';

const MOCK_LEAVE_YEAR = {
  start: new Date(Date.UTC(2025, 3, 1)),
  end: new Date(Date.UTC(2026, 2, 31)),
  startStr: '2025-04-01',
  endStr: '2026-03-31',
};

const ACTIVE_CARE_STAFF = MOCK_STAFF.filter(s => s.active !== false && ['Senior Carer', 'Carer', 'Night Carer', 'Float Senior', 'Float Carer', 'Team Lead', 'Night Senior'].includes(s.role));

function buildAccrualMap(remainingHours = 100, usedHours = 20) {
  const map = new Map();
  ACTIVE_CARE_STAFF.forEach(s => {
    map.set(s.id, {
      contractHours: s.contract_hours || 36,
      annualEntitlementHours: 201.6,
      carryoverHours: 0,
      totalEntitlementHours: 201.6,
      proRataEntitlementHours: 201.6,
      accruedHours: remainingHours + usedHours,
      usedHours,
      remainingHours,
      yearRemainingHours: remainingHours,
      isProRata: false,
      missingContractHours: false,
      entitlementWeeks: 5.6,
      usedWeeks: 0.56,
      remainingWeeks: 5.04,
    });
  });
  return map;
}

function setupMocks(overrides = {}) {
  const schedData = { ...MOCK_SCHEDULING_DATA, ...overrides };
  getSchedulingData.mockResolvedValue(schedData);
  getAccrualSummary.mockReturnValue(buildAccrualMap());
  getLeaveYear.mockReturnValue(MOCK_LEAVE_YEAR);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnnualLeave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('smoke test — renders without crashing', async () => {
    renderWithProviders(<AnnualLeave />);
    expect(await screen.findByRole('heading', { name: 'Annual Leave' })).toBeInTheDocument();
  });

  it('shows loading spinner initially', () => {
    // getSchedulingData returns a never-resolving promise so we stay in loading
    getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<AnnualLeave />);
    // The spinner is an animated div — check by class
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('loads a centered scheduling window around today', async () => {
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(getSchedulingData).toHaveBeenCalled());
    const todayDate = parseDate('2026-03-08');
    expect(getSchedulingData).toHaveBeenCalledWith('test-home', {
      from: formatDate(addDays(todayDate, -200)),
      to: formatDate(addDays(todayDate, 200)),
    });
  });

  it('shows the self-service leave view for staff self-service accounts', async () => {
    useData.mockReturnValue({
      canRead: () => true,
      canWrite: () => false,
      homeRole: 'staff_member',
      staffId: 'S001',
    });
    renderWithProviders(<AnnualLeave />, {
      user: { username: 'staff', role: 'viewer' },
    });
    await waitFor(() => expect(screen.getByText('My Leave')).toBeInTheDocument());
    expect(screen.getByText('Leave year')).toBeInTheDocument();
    expect(getSchedulingData).toHaveBeenCalled();
  });

  it('displays accrual table with staff data after load', async () => {
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Annual Leave')).toBeInTheDocument());

    // Active care staff names should appear in the table
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('Carol Davis')).toBeInTheDocument();
    // Inactive staff (Dan Wilson) should NOT appear
    expect(screen.queryByText('Dan Wilson')).not.toBeInTheDocument();
  });

  it('shows entitlement columns — Entitled, Used, Left', async () => {
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Annual Leave')).toBeInTheDocument());

    expect(screen.getByRole('columnheader', { name: 'Entitled' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Used' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Left' })).toBeInTheDocument();
  });

  it('shows team column header', async () => {
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Annual Leave')).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: 'Team' })).toBeInTheDocument();
  });

  it('renders AL calendar heatmap section', async () => {
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Annual Leave')).toBeInTheDocument());

    expect(screen.getByText('AL Calendar — Next 2 Months')).toBeInTheDocument();
  });

  it('renders calendar legend items', async () => {
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Annual Leave')).toBeInTheDocument());

    expect(screen.getByText('None')).toBeInTheDocument();
    expect(screen.getByText('Some AL')).toBeInTheDocument();
    expect(screen.getByText('Near max')).toBeInTheDocument();
    expect(screen.getByText('Max reached')).toBeInTheDocument();
  });

  it('shows leave year banner with date range', async () => {
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Annual Leave')).toBeInTheDocument());

    // The banner text contains "Leave Year:" followed by the date range
    expect(screen.getByText(/Leave Year:/)).toBeInTheDocument();
  });

  it('shows Book Leave panel', async () => {
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Annual Leave')).toBeInTheDocument());

    expect(screen.getByText('Book Leave')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Book Annual Leave/i })).toBeInTheDocument();
  });

  it('shows staff selector in book leave panel', async () => {
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Annual Leave')).toBeInTheDocument());

    const selects = screen.getAllByRole('combobox');
    // At least one select present (staff selector)
    expect(selects.length).toBeGreaterThan(0);
  });

  it('Book Annual Leave button is disabled when no staff selected', async () => {
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Annual Leave')).toBeInTheDocument());

    const bookBtn = screen.getByRole('button', { name: /Book Annual Leave/i });
    expect(bookBtn).toBeDisabled();
  });

  it('shows upcoming AL bookings section', async () => {
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Annual Leave')).toBeInTheDocument());

    expect(screen.getByText('Upcoming AL Bookings')).toBeInTheDocument();
    expect(screen.getByText('No upcoming AL bookings')).toBeInTheDocument();
  });

  it('shows upcoming booking when override has future AL', async () => {
    const futureDate = '2026-04-01';
    const schedData = {
      ...MOCK_SCHEDULING_DATA,
      overrides: {
        [futureDate]: {
          S001: { shift: 'AL', reason: 'Annual leave', source: 'al', al_hours: 12 },
        },
      },
    };
    getSchedulingData.mockResolvedValue(schedData);

    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Upcoming AL Bookings')).toBeInTheDocument());

    // Alice Smith's AL booking should appear in upcoming bookings section
    // (her name also appears in the accrual table, so use getAllByText)
    await waitFor(() => {
      const matches = screen.getAllByText('Alice Smith');
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
    // Cancel button should appear for the booking
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('handles API error — shows error message', async () => {
    getSchedulingData.mockRejectedValue(new Error('Failed to load scheduling data'));

    renderWithProviders(<AnnualLeave />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load scheduling data')).toBeInTheDocument();
    });

    // Should not show the main page content
    expect(screen.queryByText('Book Leave')).not.toBeInTheDocument();
  });

  it('shows AL Balances section heading', async () => {
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Annual Leave')).toBeInTheDocument());

    expect(screen.getByText('AL Balances')).toBeInTheDocument();
  });

  it('shows team filter dropdown with All Teams option', async () => {
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Annual Leave')).toBeInTheDocument());

    expect(screen.getByText('All Teams')).toBeInTheDocument();
  });

  it('shows Print button', async () => {
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Annual Leave')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
  });

  it('booking failure keeps the form mounted and shows error inline', async () => {
    const failure = Object.assign(new Error('Server rejected booking: max AL reached'), { status: 400 });
    bulkUpsertOverrides.mockRejectedValue(failure);

    const user = userEvent.setup();
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Book Leave')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Staff'), 'S001');
    await user.type(screen.getByLabelText('From'), '2026-03-10');
    await user.type(screen.getByLabelText('To'), '2026-03-10');

    const bookBtn = screen.getByRole('button', { name: /Book Annual Leave/i });
    await waitFor(() => expect(bookBtn).not.toBeDisabled());
    await user.click(bookBtn);

    await waitFor(() => {
      expect(screen.getByText('Server rejected booking: max AL reached')).toBeInTheDocument();
    });
    // Critical: Book Leave panel must remain mounted — no ErrorState page replacement
    expect(screen.getByText('Book Leave')).toBeInTheDocument();
    expect(screen.queryByText('Unable to load annual leave')).not.toBeInTheDocument();
  });

  it('cancel failure keeps the page mounted and shows error inline', async () => {
    const futureDate = '2026-04-01';
    const schedData = {
      ...MOCK_SCHEDULING_DATA,
      overrides: {
        [futureDate]: {
          S001: { shift: 'AL', reason: 'Annual leave', source: 'al', al_hours: 12 },
        },
      },
    };
    getSchedulingData.mockResolvedValue(schedData);
    deleteOverride.mockRejectedValue(new Error('Cancel failed'));

    const user = userEvent.setup();
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Upcoming AL Bookings')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(screen.getByText('Some annual leave actions could not be completed')).toBeInTheDocument();
    });
    expect(screen.getByText('Book Leave')).toBeInTheDocument();
    expect(screen.getByText('Cancel failed')).toBeInTheDocument();
    expect(screen.queryByText('Unable to load annual leave')).not.toBeInTheDocument();
  });

  it('shows unresolved cover gaps after booking when no automatic assignments are possible', async () => {
    bulkUpsertOverrides.mockResolvedValue({ ok: true });
    generateCoverPlan.mockReturnValue({ assignments: [], totalCost: 0, residualGaps: 2 });

    const user = userEvent.setup();
    renderWithProviders(<AnnualLeave />);
    await waitFor(() => expect(screen.getByText('Book Leave')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Staff'), 'S001');
    await user.type(screen.getByLabelText('From'), '2026-03-10');
    await user.type(screen.getByLabelText('To'), '2026-03-10');

    const bookBtn = screen.getByRole('button', { name: /Book Annual Leave/i });
    await waitFor(() => expect(bookBtn).not.toBeDisabled());
    await user.click(bookBtn);

    await waitFor(() => {
      expect(screen.getByText(/2 residual gaps remain and no automatic cover could be proposed/i)).toBeInTheDocument();
    });
  });
});
