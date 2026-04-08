import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CareCertificateTracker from '../CareCertificateTracker.jsx';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getCareCertData: vi.fn(),
    startCareCert: vi.fn(),
    updateCareCert: vi.fn(),
    deleteCareCert: vi.fn(),
    getRecordAttachments: vi.fn(),
    uploadRecordAttachment: vi.fn(),
    deleteRecordAttachment: vi.fn(),
    downloadRecordAttachment: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

vi.mock('../../hooks/useLiveDate.js', () => ({
  useLiveDate: vi.fn(() => '2026-03-08'),
}));

import * as api from '../../lib/api.js';

// ── Fixture data ──────────────────────────────────────────────────────────────

const MOCK_ACTIVE_STAFF = [
  { id: 'S001', name: 'Alice Smith', role: 'Senior Carer', team: 'Day A', active: true, start_date: '2025-01-01' },
  { id: 'S002', name: 'Bob Jones', role: 'Carer', team: 'Day B', active: true, start_date: '2025-06-01' },
  { id: 'S003', name: 'Carol Davis', role: 'Carer', team: 'Day A', active: true, start_date: '2026-01-01' },
];

// Alice has a care cert record — in_progress with some standards passed
const MOCK_CARE_CERT = {
  S001: {
    start_date: '2026-01-01',
    expected_completion: '2026-03-28',
    supervisor: 'Jane Manager',
    status: 'in_progress',
    completion_date: null,
    standards: {
      'std-1': { status: 'passed', completion_date: '2026-01-15', assessor: 'Jane', notes: '' },
    },
  },
};

const MOCK_RESPONSE = {
  staff: MOCK_ACTIVE_STAFF,
  careCert: MOCK_CARE_CERT,
};

const EMPTY_RESPONSE = {
  staff: MOCK_ACTIVE_STAFF,
  careCert: {},
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<CareCertificateTracker />, { user: { username: 'admin', role: 'admin' } });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  return renderWithProviders(<CareCertificateTracker />, { user: { username: 'viewer', role: 'viewer' }, canWrite: false });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getCareCertData.mockResolvedValue(MOCK_RESPONSE);
  api.getRecordAttachments.mockResolvedValue([]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CareCertificateTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(
        screen.queryByText('Loading...') ||
        screen.queryByText('Care Certificate Tracker')
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getCareCertData.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getCareCertData.mockRejectedValue(new Error('Failed to load'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });
  });

  it('renders page heading and KPI cards after load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Care Certificate Tracker')).toBeInTheDocument();
    });
    // KPI card labels also appear in the filter dropdown — use getAllByText
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('On Track')).toBeInTheDocument();
    // "Overdue" appears in both the KPI card and the dropdown option
    expect(screen.getAllByText('Overdue').length).toBeGreaterThanOrEqual(1);
  });

  it('shows tracked staff in the table', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
  });

  it('shows empty state message when no staff are tracked', async () => {
    api.getCareCertData.mockResolvedValue(EMPTY_RESPONSE);
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText(/No staff are being tracked/i)).toBeInTheDocument();
    });
  });

  it('admin sees Start New button when eligible staff exist', async () => {
    // S002 and S003 have no cert record — eligible
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Start New/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Start New/i })).not.toBeDisabled();
  });

  it('viewer does not see Start New button', async () => {
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText('Care Certificate Tracker')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Start New/i })).not.toBeInTheDocument();
  });

  it('Export Excel button is visible for all users', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export Excel/i })).toBeInTheDocument();
    });
  });

  it('shows progress count in table row for tracked staff', async () => {
    renderAdmin();
    await waitFor(() => {
      // Alice has 1/16 standards passed — progress shows as "1/16"
      expect(screen.getByText('1/16')).toBeInTheDocument();
    });
  });

  it('search filter narrows the staff list', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search staff...');
    await user.type(searchInput, 'bob');

    // Alice should no longer appear (not tracked + not matching anyway)
    // Alice is in trackedStaff; bob is not tracked, so Alice should disappear
    await waitFor(() => {
      expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    });
  });
});
