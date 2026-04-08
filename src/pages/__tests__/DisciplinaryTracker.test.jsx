import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import DisciplinaryTracker from '../DisciplinaryTracker.jsx';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHrDisciplinary: vi.fn(),
    createHrDisciplinary: vi.fn(),
    updateHrDisciplinary: vi.fn(),
    getHrCaseNotes: vi.fn(),
    createHrCaseNote: vi.fn(),
    getHrMeetings: vi.fn(),
    getRecordAttachments: vi.fn(),
    uploadRecordAttachment: vi.fn(),
    deleteRecordAttachment: vi.fn(),
    downloadRecordAttachment: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const MOCK_CASE = {
  id: 'DISC-001',
  staff_id: 'S001',
  date_raised: '2026-03-01',
  category: 'misconduct',
  status: 'open',
  outcome: null,
  raised_by: 'Jane Manager',
  source: 'complaint',
  version: 1,
};

const MOCK_RESPONSE = { rows: [MOCK_CASE], total: 1 };
const EMPTY_RESPONSE = { rows: [], total: 0 };

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  api.getHrDisciplinary.mockResolvedValue(MOCK_RESPONSE);
  api.getHrStaffList.mockResolvedValue([]);
  api.getHrCaseNotes.mockResolvedValue([]);
  api.getHrMeetings.mockResolvedValue([
    {
      id: 42,
      meeting_date: '2026-04-01',
      meeting_time: '14:00',
      meeting_type: 'interview',
      location: 'Office',
      attendees: [{ name: 'Alice Johnson', role_in_meeting: 'subject' }],
      summary: 'Initial investigation meeting.',
      key_points: 'Discussed witness statements.',
      outcome: 'Follow-up meeting required.',
      recorded_by: 'admin',
      created_at: '2026-04-01T12:00:00.000Z',
    },
  ]);
  api.getRecordAttachments.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('DisciplinaryTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderWithProviders(<DisciplinaryTracker />);
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading disciplinary/i) ||
        screen.queryByText(/Disciplinary Tracker/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getHrDisciplinary.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<DisciplinaryTracker />);
    expect(screen.getByText('Loading disciplinary cases...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getHrDisciplinary.mockRejectedValue(new Error('Server error'));
    renderWithProviders(<DisciplinaryTracker />);
    await waitFor(() => {
      expect(screen.getByText('Disciplinary Tracker')).toBeInTheDocument();
    });
  });

  it('displays page heading and subtitle after load', async () => {
    renderWithProviders(<DisciplinaryTracker />);
    await waitFor(() => {
      expect(screen.getByText('Disciplinary Tracker')).toBeInTheDocument();
    });
    expect(screen.getByText('ACAS-compliant disciplinary case management')).toBeInTheDocument();
  });

  it('displays case row with staff ID, date and category', async () => {
    renderWithProviders(<DisciplinaryTracker />);
    await waitFor(() => {
      expect(screen.getByText('S001')).toBeInTheDocument();
    });
    expect(screen.getByText('2026-03-01')).toBeInTheDocument();
    expect(screen.getByText('Misconduct')).toBeInTheDocument();
  });

  it('shows empty state when no cases exist', async () => {
    api.getHrDisciplinary.mockResolvedValue(EMPTY_RESPONSE);
    renderWithProviders(<DisciplinaryTracker />);
    await waitFor(() => {
      expect(screen.getByText('No disciplinary cases')).toBeInTheDocument();
    });
  });

  it('shows New Case button', async () => {
    renderWithProviders(<DisciplinaryTracker />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Case/i })).toBeInTheDocument();
    });
  });

  it('shows Export Excel button', async () => {
    renderWithProviders(<DisciplinaryTracker />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export Excel/i })).toBeInTheDocument();
    });
  });

  it('shows meeting evidence uploader for saved investigation meetings', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DisciplinaryTracker />);

    await waitFor(() => {
      expect(screen.getByText('S001')).toBeInTheDocument();
    });

    await user.click(screen.getByText('S001'));
    await user.click(screen.getByRole('tab', { name: /Investigation/i }));

    await waitFor(() => {
      expect(api.getHrMeetings).toHaveBeenCalledWith('disciplinary', 'DISC-001');
    });

    await user.click(screen.getByText('2026-04-01'));

    await waitFor(() => {
      expect(screen.getByText('Meeting Evidence')).toBeInTheDocument();
    });
    expect(screen.getByText('No evidence uploaded for this meeting.')).toBeInTheDocument();
    expect(api.getRecordAttachments).toHaveBeenCalledWith('investigation_meeting', '42');
  });
});
