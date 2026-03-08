import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import ComplaintsTracker from '../ComplaintsTracker.jsx';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getComplaints: vi.fn(),
    createComplaint: vi.fn(),
    updateComplaint: vi.fn(),
    deleteComplaint: vi.fn(),
    createComplaintSurvey: vi.fn(),
    updateComplaintSurvey: vi.fn(),
    deleteComplaintSurvey: vi.fn(),
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

const MOCK_COMPLAINT = {
  id: 'CMP-001',
  date: '2026-03-01',
  raised_by: 'resident',
  raised_by_name: 'Alice Brown',
  category: 'care-quality',
  title: 'Unsatisfactory care during night shift',
  description: 'Staff were not attentive during night shift',
  acknowledged_date: '',
  response_deadline: '2026-03-29',
  status: 'open',
  investigator: '',
  investigation_notes: '',
  resolution: '',
  resolution_date: '',
  outcome_shared: false,
  root_cause: '',
  improvements: '',
  lessons_learned: '',
  reported_by: 'admin',
  reported_at: '2026-03-01T10:00:00Z',
  updated_at: '2026-03-01T10:00:00Z',
};

const MOCK_SURVEY = {
  id: 'SRV-001',
  type: 'residents',
  date: '2026-02-15',
  title: 'Q1 2026 Resident Satisfaction Survey',
  total_sent: 30,
  responses: 22,
  overall_satisfaction: 4.2,
  key_feedback: 'Very happy with care',
  actions: '',
  conducted_by: 'Manager',
  reported_at: '2026-02-15T10:00:00Z',
};

const EMPTY_RESPONSE = {
  complaints: [],
  surveys: [],
  complaintCategories: [],
};

const MOCK_RESPONSE = {
  complaints: [MOCK_COMPLAINT],
  surveys: [MOCK_SURVEY],
  complaintCategories: [
    { id: 'care-quality', name: 'Quality of Care', active: true },
    { id: 'medication',   name: 'Medication Management', active: true },
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<ComplaintsTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  return renderWithProviders(<ComplaintsTracker />, {
    user: { username: 'viewer', role: 'viewer' },
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getComplaints.mockResolvedValue(MOCK_RESPONSE);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ComplaintsTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading complaints/i) ||
        screen.queryByText(/Complaints & Feedback/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getComplaints.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading complaints...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getComplaints.mockRejectedValue(new Error('Network error'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('displays page heading after successful load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Complaints & Feedback')).toBeInTheDocument();
    });
  });

  it('displays stat cards with correct labels', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Open Complaints')).toBeInTheDocument();
    });
    expect(screen.getByText('Avg Response')).toBeInTheDocument();
    expect(screen.getByText('Resolution Rate')).toBeInTheDocument();
    expect(screen.getByText('Satisfaction')).toBeInTheDocument();
  });

  it('displays complaint row with date, name and title', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('2026-03-01')).toBeInTheDocument();
    });
    expect(screen.getByText('Alice Brown')).toBeInTheDocument();
    expect(screen.getByText('Unsatisfactory care during night shift')).toBeInTheDocument();
  });

  it('shows empty state when no complaints exist', async () => {
    api.getComplaints.mockResolvedValue(EMPTY_RESPONSE);
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('No complaints recorded')).toBeInTheDocument();
    });
  });

  it('admin sees Log Complaint button', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Log Complaint/i })).toBeInTheDocument();
    });
  });

  it('viewer does NOT see Log Complaint button', async () => {
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText('Complaints & Feedback')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Log Complaint/i })).not.toBeInTheDocument();
  });

  it('category filter select is present', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByDisplayValue('All Categories')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('All Statuses')).toBeInTheDocument();
  });

  it('category filter narrows the complaints list', async () => {
    const user = userEvent.setup();
    const secondComplaint = {
      ...MOCK_COMPLAINT,
      id: 'CMP-002',
      category: 'medication',
      title: 'Medication given late',
      raised_by_name: 'Bob Smith',
    };
    api.getComplaints.mockResolvedValue({
      ...MOCK_RESPONSE,
      complaints: [MOCK_COMPLAINT, secondComplaint],
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText('Unsatisfactory care during night shift')).toBeInTheDocument();
      expect(screen.getByText('Medication given late')).toBeInTheDocument();
    });

    const catSelect = screen.getByDisplayValue('All Categories');
    await user.selectOptions(catSelect, 'care-quality');

    await waitFor(() => {
      expect(screen.getByText('Unsatisfactory care during night shift')).toBeInTheDocument();
      expect(screen.queryByText('Medication given late')).not.toBeInTheDocument();
    });
  });

  it('switching to surveys view shows surveys table', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /View Surveys/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /View Surveys/i }));

    await waitFor(() => {
      expect(screen.getByText('Q1 2026 Resident Satisfaction Survey')).toBeInTheDocument();
    });
    // Should now see "View Complaints" and "Add Survey" (admin)
    expect(screen.getByRole('button', { name: /View Complaints/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Survey/i })).toBeInTheDocument();
  });

  it('viewer does NOT see Add Survey button in surveys view', async () => {
    const user = userEvent.setup();
    renderViewer();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /View Surveys/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /View Surveys/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /View Complaints/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Add Survey/i })).not.toBeInTheDocument();
  });
});
