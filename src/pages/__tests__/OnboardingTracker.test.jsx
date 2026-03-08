import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import OnboardingTracker from '../OnboardingTracker.jsx';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getOnboardingData: vi.fn(),
    upsertOnboardingSection: vi.fn(),
    clearOnboardingSection: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

// ── Fixture data ──────────────────────────────────────────────────────────────

const MOCK_STAFF = [
  {
    id: 'S001', name: 'Alice Smith', role: 'Senior Carer', team: 'Day A',
    active: true, start_date: '2025-01-01',
  },
  {
    id: 'S002', name: 'Bob Jones', role: 'Carer', team: 'Day B',
    active: true, start_date: '2025-06-01',
  },
  // Inactive — should be excluded from the list
  {
    id: 'S003', name: 'Carol Inactive', role: 'Carer', team: 'Day A',
    active: false, start_date: '2024-01-01',
  },
];

// Alice has all 10 sections completed; Bob has none started
const ALICE_ONBOARDING = Object.fromEntries(
  [
    'dbs_check', 'right_to_work', 'references', 'identity_check',
    'health_declaration', 'qualifications', 'contract', 'employment_history',
    'day1_induction', 'policy_acknowledgement',
  ].map(id => [id, { status: 'completed', notes: '' }])
);

const MOCK_ONBOARDING = {
  S001: ALICE_ONBOARDING,
  // S002 intentionally has no onboarding data (all not_started)
};

const MOCK_RESPONSE = {
  staff: MOCK_STAFF,
  onboarding: MOCK_ONBOARDING,
};

const EMPTY_RESPONSE = {
  staff: MOCK_STAFF,
  onboarding: {},
};

const NO_STAFF_RESPONSE = {
  staff: [],
  onboarding: {},
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<OnboardingTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getOnboardingData.mockResolvedValue(MOCK_RESPONSE);
  api.upsertOnboardingSection.mockResolvedValue({});
  api.clearOnboardingSection.mockResolvedValue({});
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OnboardingTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading/i) ||
        screen.queryByText(/Staff Onboarding/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getOnboardingData.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getOnboardingData.mockRejectedValue(new Error('Failed to load onboarding'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Failed to load onboarding')).toBeInTheDocument();
    });
  });

  it('renders page heading and CQC regulation subtitle', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Staff Onboarding')).toBeInTheDocument();
    });
    expect(screen.getByText(/CQC Regulation 19/i)).toBeInTheDocument();
  });

  it('renders KPI cards with staff counts', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Staff Onboarding')).toBeInTheDocument();
    });
    expect(screen.getByText('Total Staff')).toBeInTheDocument();
    expect(screen.getByText('Fully Onboarded')).toBeInTheDocument();
    expect(screen.getByText('Pre-Employment Pending')).toBeInTheDocument();
    expect(screen.getByText('Induction Pending')).toBeInTheDocument();
    // 2 active staff
    expect(screen.getByText('active employees')).toBeInTheDocument();
  });

  it('shows active staff list with names and progress', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    // Inactive staff must not appear
    expect(screen.queryByText('Carol Inactive')).not.toBeInTheDocument();
  });

  it('shows Complete badge for fully onboarded staff', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    // Alice has all 10 sections completed
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('shows In Progress badge for partially onboarded staff', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    });
    // Bob has no onboarding data — shows "In Progress" (not started = in progress badge)
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
  });

  it('expands staff row to show onboarding sections on click', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    // The clickable element is the flex div with cursor-pointer directly inside the card.
    // Alice's name span is inside that div — find the div with cursor-pointer closest to it.
    const aliceNameEl = screen.getByText('Alice Smith');
    const clickTarget = aliceNameEl.closest('.cursor-pointer');
    expect(clickTarget).not.toBeNull();
    await user.click(clickTarget);

    // Should show Pre-Employment Checks and Day 1 Induction section headings
    await waitFor(() => {
      expect(screen.getByText('Pre-Employment Checks')).toBeInTheDocument();
    });
    // "Day 1 Induction" appears as both the section group heading AND as a section card name
    expect(screen.getAllByText('Day 1 Induction').length).toBeGreaterThanOrEqual(1);
    // Should show individual section names
    expect(screen.getByText('Enhanced DBS Check')).toBeInTheDocument();
    expect(screen.getByText('Right to Work')).toBeInTheDocument();
  });

  it('shows "no staff match" message when search returns no results', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search staff...');
    await user.type(searchInput, 'zzznomatch');

    await waitFor(() => {
      expect(screen.getByText(/No staff match the current filters/i)).toBeInTheDocument();
    });
  });

  it('Export Excel button is visible', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Staff Onboarding')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Export Excel/i })).toBeInTheDocument();
  });
});
