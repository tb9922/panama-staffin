import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import GrievanceTracker from '../GrievanceTracker.jsx';

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
    getHrStaffList: vi.fn().mockResolvedValue([
      { id: 'S002', name: 'Bob Smith', role: 'Senior Carer', active: true },
    ]),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

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

function renderAdmin() {
  return renderWithProviders(<GrievanceTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getHrGrievance.mockResolvedValue(MOCK_RESPONSE);
  api.getHrStaffList.mockResolvedValue([
    { id: 'S002', name: 'Bob Smith', role: 'Senior Carer', active: true },
  ]);
  api.getGrievanceActions.mockResolvedValue([]);
  api.getHrCaseNotes.mockResolvedValue([]);
});

describe('GrievanceTracker', () => {
  it('smoke test - renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.queryByText(/Loading grievance/i) || screen.queryByText(/Grievance Tracker/i)).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getHrGrievance.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading grievance cases...')).toBeInTheDocument();
  });

  it('shows retryable error state when API call fails', async () => {
    api.getHrGrievance.mockRejectedValue(new Error('Connection lost'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Connection lost')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('displays page heading and subtitle after load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Grievance Tracker')).toBeInTheDocument();
    });
    expect(screen.getByText('ACAS-compliant grievance case management')).toBeInTheDocument();
  });

  it('displays case row with staff ID and date', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('S002')).toBeInTheDocument();
    });
    expect(screen.getByText('2026-02-15')).toBeInTheDocument();
  });

  it('shows confidential badge for confidential cases', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Yes')).toBeInTheDocument();
    });
  });

  it('shows non-confidential badge for non-confidential cases', async () => {
    api.getHrGrievance.mockResolvedValue({ rows: [MOCK_NON_CONFIDENTIAL], total: 1 });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('No')).toBeInTheDocument();
    });
  });

  it('shows action-first empty state when no cases exist', async () => {
    api.getHrGrievance.mockResolvedValue(EMPTY_RESPONSE);
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('No grievance cases yet')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('button', { name: /New Case/i }).length).toBeGreaterThan(1);
  });

  it('shows a success notice after creating a grievance case', async () => {
    const user = userEvent.setup();
    api.createHrGrievance.mockResolvedValue({ id: 'GRV-003' });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Case/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /New Case/i }));
    await user.selectOptions(screen.getByLabelText(/Staff Member/i), 'S002');
    await user.selectOptions(screen.getByLabelText(/Category/i), 'working_conditions');
    await user.type(screen.getByLabelText(/Description/i), 'The grievance details are recorded here.');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.createHrGrievance).toHaveBeenCalledWith('test-home', expect.objectContaining({
        staff_id: 'S002',
        category: 'working_conditions',
      }));
    });

    await waitFor(() => {
      expect(screen.getByText('Grievance case created.')).toBeInTheDocument();
    });
  });
});
