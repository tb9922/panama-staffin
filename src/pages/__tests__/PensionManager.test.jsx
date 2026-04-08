import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import PensionManager from '../PensionManager.jsx';

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
    getRecordAttachments: vi.fn(),
    uploadRecordAttachment: vi.fn(),
    deleteRecordAttachment: vi.fn(),
    downloadRecordAttachment: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

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
  lower_qualifying_weekly: 120,
  upper_qualifying_weekly: 967,
};

const MOCK_ENROLMENTS = [
  {
    staff_id: 'S001',
    status: 'eligible_enrolled',
    enrolled_date: '2024-01-01',
    opted_out_date: null,
    reassessment_date: null,
    contribution_override_employee: null,
    contribution_override_employer: null,
    notes: '',
  },
  {
    staff_id: 'S002',
    status: 'opted_out',
    enrolled_date: '2024-01-01',
    opted_out_date: '2024-06-01',
    reassessment_date: '2027-06-01',
    contribution_override_employee: 0.055,
    contribution_override_employer: 0.035,
    notes: 'Opted out by written notice',
  },
];

function setupMocks(enrolments = MOCK_ENROLMENTS) {
  api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
  api.getPensionEnrolments.mockResolvedValue(enrolments);
  api.getPensionConfig.mockResolvedValue(MOCK_CONFIG);
  api.upsertPensionEnrolment.mockResolvedValue({});
  api.getRecordAttachments.mockResolvedValue([]);
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
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

describe('PensionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
    api.getRecordAttachments.mockResolvedValue([]);
  });

  it('renders without crashing', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Pension Auto-Enrolment')).toBeInTheDocument()
    );
  });

  it('shows loading state initially', () => {
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    api.getPensionEnrolments.mockReturnValue(new Promise(() => {}));
    api.getPensionConfig.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<PensionManager />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows an error message when the API fails', async () => {
    api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
    api.getPensionEnrolments.mockRejectedValue(new Error('Connection refused'));
    api.getPensionConfig.mockResolvedValue(MOCK_CONFIG);
    renderWithProviders(<PensionManager />);
    await waitFor(() =>
      expect(screen.getByText('Connection refused')).toBeInTheDocument()
    );
  });

  it('renders pension config summary cards with qualifying earnings values', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Employee contribution')).toBeInTheDocument()
    );
    expect(screen.getByText('Employer contribution')).toBeInTheDocument();
    expect(screen.getByText('Lower earnings')).toBeInTheDocument();
    expect(screen.getByText('Upper earnings')).toBeInTheDocument();
    expect(screen.getByText('£120.00 /wk')).toBeInTheDocument();
    expect(screen.getByText('£967.00 /wk')).toBeInTheDocument();
  });

  it('renders the enrolment table with action controls for managers', async () => {
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

  it('shows the add enrolment button for managers', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Pension Auto-Enrolment')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Add / Update Enrolment' })).toBeInTheDocument();
  });

  it('hides mutation controls for viewers', async () => {
    renderViewer();
    await waitFor(() =>
      expect(screen.getByText('Pension Auto-Enrolment')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Add / Update Enrolment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('shows an alert when staff have no enrolment record', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText(/have no pension enrolment record/)).toBeInTheDocument()
    );
    expect(screen.getAllByText(/Carol Davis/).length).toBeGreaterThanOrEqual(1);
  });

  it('saves edits using the backend pension field names', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Bob Jones')).toBeInTheDocument());

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    await user.click(screen.getByRole('button', { name: 'Save Enrolment' }));

    await waitFor(() => expect(api.upsertPensionEnrolment).toHaveBeenCalled());
    expect(api.upsertPensionEnrolment).toHaveBeenCalledWith('test-home', expect.objectContaining({
      staff_id: 'S002',
      opted_out_date: '2024-06-01',
      reassessment_date: '2027-06-01',
      contribution_override_employee: 0.055,
      contribution_override_employer: 0.035,
    }));
    const payload = api.upsertPensionEnrolment.mock.calls[0][1];
    expect(payload).not.toHaveProperty('opt_out_date');
    expect(payload).not.toHaveProperty('re_enrolled_date');
  });
});
