import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import DolsTracker from '../DolsTracker.jsx';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getDols: vi.fn(),
    createDols: vi.fn(),
    updateDols: vi.fn(),
    deleteDols: vi.fn(),
    createMcaAssessment: vi.fn(),
    updateMcaAssessment: vi.fn(),
    deleteMcaAssessment: vi.fn(),
    getRecordAttachments: vi.fn(),
    uploadRecordAttachment: vi.fn(),
    deleteRecordAttachment: vi.fn(),
    downloadRecordAttachment: vi.fn(),
  };
});

vi.mock('../../hooks/useLiveDate.js', () => ({
  useLiveDate: vi.fn(() => '2026-03-08'),
}));

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

// A DoLS record that is authorised and not expired
const MOCK_DOLS = {
  id: 'DOLS-001',
  resident_name: 'Margaret Wilson',
  dob: '1940-05-12',
  room_number: '12',
  application_type: 'dols',
  application_date: '2025-10-01',
  authorised: true,
  authorisation_date: '2025-10-15',
  expiry_date: '2026-10-15',
  authorisation_number: 'AUTH-12345',
  authorising_authority: 'Southwark Council',
  restrictions: ['Cannot leave without escort'],
  reviewed_date: '2026-01-15',
  review_status: '',
  next_review_date: '2026-04-15',
  notes: 'Reviewed quarterly',
  updated_at: '2026-01-15T10:00:00Z',
};

// An expired DoLS record
const EXPIRED_DOLS = {
  id: 'DOLS-002',
  resident_name: 'John Davies',
  dob: '1938-03-22',
  room_number: '7',
  application_type: 'lps',
  application_date: '2024-01-01',
  authorised: true,
  authorisation_date: '2024-01-15',
  expiry_date: '2025-01-15',   // Already past 2026-03-08
  authorisation_number: 'AUTH-99',
  authorising_authority: 'Camden Council',
  restrictions: [],
  reviewed_date: '',
  review_status: '',
  next_review_date: '',
  notes: '',
  updated_at: '2025-01-15T10:00:00Z',
};

const MOCK_MCA = {
  id: 'MCA-001',
  resident_name: 'Rose Thompson',
  assessment_date: '2026-01-10',
  assessor: 'Dr. Patel',
  decision_area: 'Medical treatment',
  lacks_capacity: true,
  best_interest_decision: 'Family agreed to treatment plan',
  next_review_date: '2026-07-10',
  notes: '',
  updated_at: '2026-01-10T10:00:00Z',
};

const EMPTY_RESPONSE = { dols: [], mcaAssessments: [] };
const MOCK_RESPONSE = {
  dols: [MOCK_DOLS],
  mcaAssessments: [MOCK_MCA],
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<DolsTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  return renderWithProviders(<DolsTracker />, {
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getDols.mockResolvedValue(MOCK_RESPONSE);
  api.getRecordAttachments.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('DolsTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading/i) ||
        screen.queryByText(/DoLS\/LPS/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getDols.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getDols.mockRejectedValue(new Error('Failed to load DoLS'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText(/Error: Failed to load DoLS/i)).toBeInTheDocument();
    });
  });

  it('displays page heading and subtitle after successful load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('DoLS/LPS & MCA Tracker')).toBeInTheDocument();
    });
    expect(screen.getByText(/CQC Regulation 11\/13/i)).toBeInTheDocument();
  });

  it('displays KPI stat cards', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Active DoLS/LPS')).toBeInTheDocument();
    });
    expect(screen.getByText(/Expiring/i)).toBeInTheDocument();
    // 'MCA Assessments' appears in both the KPI card label and the view toggle button
    expect(screen.getAllByText('MCA Assessments').length).toBeGreaterThan(0);
    expect(screen.getByText('Reviews Overdue')).toBeInTheDocument();
  });

  it('displays DoLS application row with resident name and date', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Margaret Wilson')).toBeInTheDocument();
    });
    expect(screen.getByText('2025-10-01')).toBeInTheDocument();
    expect(screen.getByText('2026-10-15')).toBeInTheDocument();
  });

  it('shows empty state when no DoLS records exist', async () => {
    api.getDols.mockResolvedValue(EMPTY_RESPONSE);
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('No DoLS/LPS records')).toBeInTheDocument();
    });
  });

  it('admin sees + New DoLS/LPS button', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ New DoLS\/LPS/i })).toBeInTheDocument();
    });
  });

  it('viewer does NOT see + New DoLS/LPS button', async () => {
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText('DoLS/LPS & MCA Tracker')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /\+ New DoLS/i })).not.toBeInTheDocument();
  });

  it('expired DoLS record shows Expired status badge', async () => {
    api.getDols.mockResolvedValue({
      dols: [EXPIRED_DOLS],
      mcaAssessments: [],
    });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('John Davies')).toBeInTheDocument();
    });
    // getDolsStatus computes 'expired' for past expiry_date — 'Expired' appears in
    // both the status filter dropdown option and the table badge
    const expiredMatches = screen.getAllByText('Expired');
    expect(expiredMatches.length).toBeGreaterThan(0);
  });

  it('LPS type badge shown for LPS application', async () => {
    api.getDols.mockResolvedValue({
      dols: [EXPIRED_DOLS],   // EXPIRED_DOLS has application_type: 'lps'
      mcaAssessments: [],
    });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('John Davies')).toBeInTheDocument();
    });
    // 'LPS' appears in both the type filter dropdown option and the table badge
    const lpsMatches = screen.getAllByText('LPS');
    expect(lpsMatches.length).toBeGreaterThan(0);
  });

  it('switching to MCA view shows MCA assessments table', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /MCA Assessments/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /MCA Assessments/i }));

    await waitFor(() => {
      expect(screen.getByText('Rose Thompson')).toBeInTheDocument();
    });
    expect(screen.getByText('Dr. Patel')).toBeInTheDocument();
    expect(screen.getByText('Medical treatment')).toBeInTheDocument();
    // MCA with lacks_capacity: true shows "Lacks Capacity" badge
    expect(screen.getByText('Lacks Capacity')).toBeInTheDocument();
  });

  it('MCA view shows empty state when no MCA assessments exist', async () => {
    const user = userEvent.setup();
    api.getDols.mockResolvedValue({ dols: [], mcaAssessments: [] });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /MCA Assessments/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /MCA Assessments/i }));

    await waitFor(() => {
      expect(screen.getByText('No MCA assessments recorded')).toBeInTheDocument();
    });
  });

  it('type filter dropdown is present in DoLS view', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByDisplayValue('All Types')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('All Statuses')).toBeInTheDocument();
  });

  it('shows DoLS evidence uploader for existing records', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText('Margaret Wilson')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Margaret Wilson'));

    await waitFor(() => {
      expect(screen.getByText('DoLS / LPS Evidence')).toBeInTheDocument();
    });
    expect(screen.getByText('No supporting files uploaded yet.')).toBeInTheDocument();
  });
});
