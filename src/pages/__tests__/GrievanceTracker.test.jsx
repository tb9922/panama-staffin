import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import GrievanceTracker from '../GrievanceTracker.jsx';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHrGrievance: vi.fn(),
    createHrGrievance: vi.fn(),
    updateHrGrievance: vi.fn(),
    getGrievanceActions: vi.fn(),
    createGrievanceAction: vi.fn(),
    updateGrievanceAction: vi.fn(),
    getHrCaseNotes: vi.fn(),
    createHrCaseNote: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const MOCK_CASE = {
  id: 'GRV-001',
  staff_id: 'S002',
  date_raised: '2026-02-15',
  category: 'working_conditions',
  confidential: true,
  status: 'open',
  outcome: null,
  version: 1,
};

const MOCK_NON_CONFIDENTIAL = {
  id: 'GRV-002',
  staff_id: 'S003',
  date_raised: '2026-02-20',
  category: 'bullying',
  confidential: false,
  status: 'investigating',
  version: 1,
};

const MOCK_RESPONSE = { rows: [MOCK_CASE], total: 1 };
const EMPTY_RESPONSE = { rows: [], total: 0 };

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  api.getHrGrievance.mockResolvedValue(MOCK_RESPONSE);
  api.getHrStaffList.mockResolvedValue([]);
  api.getGrievanceActions.mockResolvedValue([]);
  api.getHrCaseNotes.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GrievanceTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderWithProviders(<GrievanceTracker />);
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading grievance/i) ||
        screen.queryByText(/Grievance Tracker/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getHrGrievance.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<GrievanceTracker />);
    expect(screen.getByText('Loading grievance cases...')).toBeInTheDocument();
  });

  it('shows error state when API call fails', async () => {
    api.getHrGrievance.mockRejectedValue(new Error('Connection lost'));
    renderWithProviders(<GrievanceTracker />);
    await waitFor(() => {
      expect(screen.getByText('Grievance Tracker')).toBeInTheDocument();
    });
  });

  it('displays page heading and subtitle after load', async () => {
    renderWithProviders(<GrievanceTracker />);
    await waitFor(() => {
      expect(screen.getByText('Grievance Tracker')).toBeInTheDocument();
    });
    expect(screen.getByText('ACAS-compliant grievance case management')).toBeInTheDocument();
  });

  it('displays case row with staff ID and date', async () => {
    renderWithProviders(<GrievanceTracker />);
    await waitFor(() => {
      expect(screen.getByText('S002')).toBeInTheDocument();
    });
    expect(screen.getByText('2026-02-15')).toBeInTheDocument();
  });

  it('shows confidential badge for confidential cases', async () => {
    renderWithProviders(<GrievanceTracker />);
    await waitFor(() => {
      expect(screen.getByText('Yes')).toBeInTheDocument();
    });
  });

  it('shows non-confidential badge for non-confidential cases', async () => {
    api.getHrGrievance.mockResolvedValue({ rows: [MOCK_NON_CONFIDENTIAL], total: 1 });
    renderWithProviders(<GrievanceTracker />);
    await waitFor(() => {
      expect(screen.getByText('No')).toBeInTheDocument();
    });
  });

  it('shows empty state when no cases exist', async () => {
    api.getHrGrievance.mockResolvedValue(EMPTY_RESPONSE);
    renderWithProviders(<GrievanceTracker />);
    await waitFor(() => {
      expect(screen.getByText('No grievance cases')).toBeInTheDocument();
    });
  });

  it('shows New Case button', async () => {
    renderWithProviders(<GrievanceTracker />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Case/i })).toBeInTheDocument();
    });
  });

  it('shows Export Excel button', async () => {
    renderWithProviders(<GrievanceTracker />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export Excel/i })).toBeInTheDocument();
    });
  });

  it('uses a select for appeal outcome in the edit flow', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GrievanceTracker />);
    await waitFor(() => {
      expect(screen.getByText('S002')).toBeInTheDocument();
    });

    await user.click(screen.getByText('S002'));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Appeal' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: 'Appeal' }));

    expect(screen.getByLabelText('Appeal Outcome')).toHaveDisplayValue('Select...');
    expect(screen.getByRole('option', { name: 'Partially Upheld' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Overturned' })).toBeInTheDocument();
  });
});
