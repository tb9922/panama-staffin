import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PolicyReviewTracker from '../PolicyReviewTracker.jsx';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getPolicies: vi.fn(),
    createPolicy: vi.fn(),
    updatePolicy: vi.fn(),
    deletePolicy: vi.fn(),
    getRecordAttachments: vi.fn(),
    uploadRecordAttachment: vi.fn(),
    deleteRecordAttachment: vi.fn(),
    downloadRecordAttachment: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({ downloadXLSX: vi.fn() }));

vi.mock('../../hooks/useLiveDate.js', () => ({
  useLiveDate: vi.fn(() => '2026-03-08'),
}));

import * as api from '../../lib/api.js';

// ── Fixture data ───────────────────────────────────────────────────────────────

// A policy reviewed recently — next due well in future (current status)
const CURRENT_POLICY = {
  id: 'pol-001',
  policy_name: 'Safeguarding Adults & Children',
  policy_ref: 'POL-001',
  category: 'safeguarding',
  version: '2.1',
  last_reviewed: '2026-01-15',
  next_review_due: '2027-01-15',
  review_frequency_months: 12,
  reviewed_by: 'Jane Manager',
  approved_by: 'John Director',
  changes: [
    { version: '2.0', date: '2025-01-15', summary: 'Annual review' },
    { version: '2.1', date: '2026-01-15', summary: 'Reviewed and approved' },
  ],
  notes: 'No changes required',
};

// A policy whose review is well past due (overdue)
const OVERDUE_POLICY = {
  id: 'pol-002',
  policy_name: 'Health & Safety',
  policy_ref: 'POL-002',
  category: 'health-safety',
  version: '1.3',
  last_reviewed: '2024-01-01',
  next_review_due: '2025-01-01',  // Past today (2026-03-08) → overdue
  review_frequency_months: 12,
  reviewed_by: 'Safety Officer',
  approved_by: '',
  changes: [],
  notes: '',
};

const MOCK_POLICIES_RESPONSE = {
  policies: [CURRENT_POLICY, OVERDUE_POLICY],
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<PolicyReviewTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  return renderWithProviders(<PolicyReviewTracker />, {
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getPolicies.mockResolvedValue(MOCK_POLICIES_RESPONSE);
  api.getRecordAttachments.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('PolicyReviewTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading policy reviews/i) ||
        screen.queryByText(/Policy Review Tracker/i),
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getPolicies.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading policy reviews...')).toBeInTheDocument();
  });

  it('displays error message when API call fails', async () => {
    api.getPolicies.mockRejectedValue(new Error('Failed to load policies'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Failed to load policies')).toBeInTheDocument();
    });
  });

  it('displays the page heading and subtitle after load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Policy Review Tracker')).toBeInTheDocument();
    });
    expect(screen.getByText('CQC Regulation 17 — Governance & Management')).toBeInTheDocument();
  });

  it('shows KPI card labels for current, due, overdue, compliance', async () => {
    renderAdmin();
    await waitFor(() => {
      // Use unique sub-labels to identify each KPI card unambiguously
      // "Up to date" is the sub-label under the Current KPI card
      expect(screen.getByText('Up to date')).toBeInTheDocument();
    });
    // "Within 30 days" is unique to the Due for Review card
    expect(screen.getByText('Within 30 days')).toBeInTheDocument();
    // "Past review date" is unique to the Overdue card
    expect(screen.getByText('Past review date')).toBeInTheDocument();
    // "Current + Due" is unique to the Compliance % card
    expect(screen.getByText('Current + Due')).toBeInTheDocument();
  });

  it('renders policy rows with name, version, reviewer, and date columns', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Safeguarding Adults & Children')).toBeInTheDocument();
    });
    expect(screen.getByText('Health & Safety')).toBeInTheDocument();
    // Version values
    expect(screen.getByText('2.1')).toBeInTheDocument();
    // Reviewed-by field
    expect(screen.getByText('Jane Manager')).toBeInTheDocument();
  });

  it('renders status badges for current and overdue policies', async () => {
    renderAdmin();
    await waitFor(() => {
      // CURRENT_POLICY next due 2027-01-15 → status 'current' → label 'Current'
      // OVERDUE_POLICY next due 2025-01-01 → status 'overdue' → label 'Overdue'
      // Both appear in the table as badge spans; they may also appear elsewhere
      expect(screen.getAllByText('Current').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0);
    });
  });

  it('admin sees the + New Policy button', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ New Policy/i })).toBeInTheDocument();
    });
  });

  it('viewer does NOT see the + New Policy button', async () => {
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText('Policy Review Tracker')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /\+ New Policy/i })).not.toBeInTheDocument();
  });

  it('shows empty state when no policies exist', async () => {
    api.getPolicies.mockResolvedValue({ policies: [] });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('No policies recorded')).toBeInTheDocument();
    });
  });

  it('Export Excel button is present for all users', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export Excel/i })).toBeInTheDocument();
    });
  });

  it('shows policy count in the filter bar', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText(/\d+ policies/)).toBeInTheDocument();
    });
  });

  it('shows policy documents uploader for existing policies', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText('Safeguarding Adults & Children')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Safeguarding Adults & Children'));

    await waitFor(() => {
      expect(screen.getByText('Policy Documents')).toBeInTheDocument();
    });
    expect(screen.getByText('No policy documents uploaded yet.')).toBeInTheDocument();
  });
});
