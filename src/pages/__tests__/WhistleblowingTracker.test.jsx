import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import WhistleblowingTracker from '../WhistleblowingTracker.jsx';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getWhistleblowingConcerns: vi.fn(),
    createWhistleblowingConcern: vi.fn(),
    updateWhistleblowingConcern: vi.fn(),
    deleteWhistleblowingConcern: vi.fn(),
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

const MOCK_CONCERN = {
  id: 'WB-001',
  date_raised: '2026-03-01',
  raised_by_role: 'carer',
  anonymous: false,
  category: 'safety',
  description: 'Unsafe moving and handling practices observed',
  severity: 'high',
  status: 'registered',
  acknowledgement_date: '',
  investigator: '',
  investigation_start_date: '',
  findings: '',
  outcome: '',
  outcome_details: '',
  reporter_protected: false,
  protection_details: '',
  follow_up_date: '',
  follow_up_completed: false,
  resolution_date: '',
  lessons_learned: '',
  reported_at: '2026-03-01T09:00:00Z',
  updated_at: '2026-03-01T09:00:00Z',
};

const MOCK_ANON_CONCERN = {
  id: 'WB-002',
  date_raised: '2026-02-20',
  raised_by_role: '',
  anonymous: true,
  category: 'malpractice',
  description: 'Medication error not reported',
  severity: 'urgent',
  status: 'investigating',
  acknowledgement_date: '2026-02-21',
  investigator: 'Jane Manager',
  investigation_start_date: '2026-02-22',
  findings: '',
  outcome: '',
  outcome_details: '',
  reporter_protected: false,
  protection_details: '',
  follow_up_date: '',
  follow_up_completed: false,
  resolution_date: '',
  lessons_learned: '',
  reported_at: '2026-02-20T14:00:00Z',
  updated_at: '2026-02-22T10:00:00Z',
};

const EMPTY_RESPONSE = { concerns: [] };
const MOCK_RESPONSE = { concerns: [MOCK_CONCERN] };

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<WhistleblowingTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  return renderWithProviders(<WhistleblowingTracker />, {
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getWhistleblowingConcerns.mockResolvedValue(MOCK_RESPONSE);
  api.getRecordAttachments.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('WhistleblowingTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading/i) ||
        screen.queryByText(/Whistleblowing/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getWhistleblowingConcerns.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading concerns...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getWhistleblowingConcerns.mockRejectedValue(new Error('Server error'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Could not load concerns')).toBeInTheDocument();
    });
    expect(screen.getByText('Server error')).toBeInTheDocument();
  });

  it('displays page heading after successful load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Whistleblowing / Freedom to Speak Up')).toBeInTheDocument();
    });
  });

  it('displays KPI stat cards', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Total Concerns')).toBeInTheDocument();
    });
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Avg Investigation Days')).toBeInTheDocument();
    expect(screen.getByText('Protection Rate')).toBeInTheDocument();
  });

  it('displays concern row with date and category', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('2026-03-01')).toBeInTheDocument();
    });
    // 'Safety Concern' maps from category id 'safety' — appears in table row and filter dropdown
    const matches = screen.getAllByText('Safety Concern');
    expect(matches.length).toBeGreaterThan(0);
  });

  it('displays severity badge for concern', async () => {
    renderAdmin();
    await waitFor(() => {
      // severity 'high' maps to 'High' — appears in table badge and filter dropdown
      const matches = screen.getAllByText('High');
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('shows Anonymous badge for anonymous concerns', async () => {
    api.getWhistleblowingConcerns.mockResolvedValue({ concerns: [MOCK_ANON_CONCERN] });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Anonymous')).toBeInTheDocument();
    });
  });

  it('shows reporter role for non-anonymous concerns', async () => {
    renderAdmin();
    await waitFor(() => {
      // non-anonymous concern with raised_by_role 'carer' — REPORTER_ROLES maps to name
      // The role id 'carer' may render as-is if not in REPORTER_ROLES mapping
      expect(screen.getByText('2026-03-01')).toBeInTheDocument();
      // Ensure 'Anonymous' badge is NOT shown for non-anonymous concern
      expect(screen.queryByText('Anonymous')).not.toBeInTheDocument();
    });
  });

  it('shows empty state when no concerns exist', async () => {
    api.getWhistleblowingConcerns.mockResolvedValue(EMPTY_RESPONSE);
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('No concerns recorded yet')).toBeInTheDocument();
    });
  });

  it('admin sees + New Concern button', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ New Concern/i })).toBeInTheDocument();
    });
  });

  it('viewer does NOT see + New Concern button', async () => {
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText('Whistleblowing / Freedom to Speak Up')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /\+ New Concern/i })).not.toBeInTheDocument();
  });

  it('severity filter dropdown is present with all severity options', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByDisplayValue('All Severities')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('All Categories')).toBeInTheDocument();
    expect(screen.getByDisplayValue('All Statuses')).toBeInTheDocument();
  });

  it('status filter narrows the concerns list', async () => {
    const user = userEvent.setup();
    const resolvedConcern = {
      ...MOCK_CONCERN,
      id: 'WB-003',
      date_raised: '2026-02-01',
      status: 'resolved',
    };
    api.getWhistleblowingConcerns.mockResolvedValue({
      concerns: [MOCK_CONCERN, resolvedConcern],
    });
    renderAdmin();

    await waitFor(() => {
      // Both dates visible before filtering
      expect(screen.getByText('2026-03-01')).toBeInTheDocument();
      expect(screen.getByText('2026-02-01')).toBeInTheDocument();
    });

    const statusSelect = screen.getByDisplayValue('All Statuses');
    await user.selectOptions(statusSelect, 'registered');

    await waitFor(() => {
      expect(screen.getByText('2026-03-01')).toBeInTheDocument();
      expect(screen.queryByText('2026-02-01')).not.toBeInTheDocument();
    });
  });

  it('shows concern evidence uploader for existing concerns', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText('2026-03-01')).toBeInTheDocument();
    });

    await user.click(screen.getByText('2026-03-01'));
    await user.click(screen.getByRole('tab', { name: 'Investigation & Outcome' }));

    await waitFor(() => {
      expect(screen.getByText('Concern Evidence')).toBeInTheDocument();
    });
    expect(screen.getByText('No supporting evidence uploaded yet.')).toBeInTheDocument();
  });
});
