import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import PensionManager from '../PensionManager.jsx';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getSchedulingData: vi.fn(),
    getPensionEnrolments: vi.fn(),
    upsertPensionEnrolment: vi.fn(),
    getPensionConfig: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([]),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import * as api from '../../lib/api.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_SCHED_DATA = {
  staff: [
    { id: 'S001', name: 'Alice Smith', role: 'Senior Carer', active: true, contract_hours: 36 },
    { id: 'S002', name: 'Bob Jones', role: 'Carer', active: true, contract_hours: 36 },
    { id: 'S003', name: 'Carol Davis', role: 'Night Carer', active: true, contract_hours: 30 },
  ],
  overrides: {},
  config: {
    cycle_start_date: '2025-01-06',
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
    bank_holidays: [],
  },
};

const MOCK_CONFIG = {
  employee_rate: 0.05,
  employer_rate: 0.03,
  lower_weekly: 120,
  upper_weekly: 967,
};

const MOCK_ENROLMENTS = [
  {
    staff_id: 'S001',
    status: 'eligible_enrolled',
    enrolment_date: '2024-01-01',
    opt_out_date: null,
    re_enrolment_date: null,
    contribution_override_employee: null,
    contribution_override_employer: null,
    notes: '',
  },
  {
    staff_id: 'S002',
    status: 'opted_out',
    enrolment_date: '2024-01-01',
    opt_out_date: '2024-06-01',
    re_enrolment_date: '2027-06-01',
    contribution_override_employee: null,
    contribution_override_employer: null,
    notes: 'Opted out by written notice',
  },
];

function setupMocks(enrolments = MOCK_ENROLMENTS) {
  api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
  api.getPensionEnrolments.mockResolvedValue(enrolments);
  api.getPensionConfig.mockResolvedValue(MOCK_CONFIG);
  api.upsertPensionEnrolment.mockResolvedValue({});
}

function renderAdmin(enrolments) {
  setupMocks(enrolments);
  return renderWithProviders(<PensionManager />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer(enrolments) {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  setupMocks(enrolments);
  return renderWithProviders(<PensionManager />, {
    user: { username: 'viewer', role: 'viewer' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PensionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
  });

  it('smoke test -- renders without crashing', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Pension Auto-Enrolment')).toBeInTheDocument()
    );
  });

  it('shows loading state initially', () => {
    api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
    api.getPensionEnrolments.mockReturnValue(new Promise(() => {}));
    api.getPensionConfig.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<PensionManager />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error message when API fails', async () => {
    api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
    api.getPensionEnrolments.mockRejectedValue(new Error('Connection refused'));
    api.getPensionConfig.mockResolvedValue(MOCK_CONFIG);
    renderWithProviders(<PensionManager />);
    await waitFor(() =>
      expect(screen.getByText('Connection refused')).toBeInTheDocument()
    );
  });

  it('renders pension config summary cards', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Employee contribution')).toBeInTheDocument()
    );
    expect(screen.getByText('Employer contribution')).toBeInTheDocument();
    expect(screen.getByText('Lower earnings')).toBeInTheDocument();
    expect(screen.getByText('Upper earnings')).toBeInTheDocument();
  });

  it('renders enrolment table with correct column headers', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: 'Staff Member' })).toBeInTheDocument()
    );
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Enrolment Date' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
  });

  it('shows summary pills with enrolled, pending, and opted out counts', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Pension Auto-Enrolment')).toBeInTheDocument()
    );
    expect(screen.getByText('1 enrolled')).toBeInTheDocument();
    expect(screen.getByText('0 pending assessment')).toBeInTheDocument();
    expect(screen.getByText('1 opted out')).toBeInTheDocument();
  });

  it('shows Add / Update Enrolment button for admin', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Pension Auto-Enrolment')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Add / Update Enrolment' })).toBeInTheDocument();
  });

  it('hides Add / Update Enrolment button and Actions column for viewer', async () => {
    renderViewer();
    await waitFor(() =>
      expect(screen.getByText('Pension Auto-Enrolment')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Add / Update Enrolment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('shows unrecorded staff alert when staff have no enrolment', async () => {
    renderAdmin();
    // Wait for scheduling data to load (which populates activeStaff / unrecorded list)
    // S003 has no enrolment record — the alert depends on schedData being loaded
    await waitFor(() =>
      expect(screen.getByText(/have no pension enrolment record/)).toBeInTheDocument()
    );
    expect(screen.getAllByText(/Carol Davis/).length).toBeGreaterThanOrEqual(1);
  });
});
