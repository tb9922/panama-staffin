import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MaintenanceDocsTracker from '../MaintenanceDocsTracker.jsx';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getMaintenanceDocs: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

const DOCS_RESPONSE = {
  summary: {
    total_checks: 2,
    missing_evidence_count: 1,
    expiring_count: 1,
    overdue_count: 1,
  },
  checks: [
    {
      id: 'm-1',
      category_name: 'PAT Testing',
      description: 'Annual PAT check',
      contractor: 'Acme',
      attachment_count: 1,
      missing_evidence: false,
      certificate_expiring: false,
      status: { status: 'compliant', label: 'Compliant' },
    },
    {
      id: 'm-2',
      category_name: 'Gas Safety',
      description: 'Annual gas inspection',
      contractor: '',
      attachment_count: 0,
      missing_evidence: true,
      certificate_expiring: true,
      status: { status: 'overdue', label: 'Overdue' },
    },
  ],
  byCategory: [
    { id: 'pat', name: 'PAT Testing', checks: 1, attachment_count: 1, missing_evidence_count: 0, expiring_count: 0 },
    { id: 'gas', name: 'Gas Safety', checks: 1, attachment_count: 0, missing_evidence_count: 1, expiring_count: 1 },
  ],
  byContractor: [
    { contractor: 'Acme', checks: 1, attachment_count: 1, evidence_gap: false },
  ],
};

function renderAdmin(options = {}) {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<MaintenanceDocsTracker />, {
    user: { username: 'admin', role: 'admin' },
    ...options,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getCurrentHome.mockReturnValue('test-home');
  api.getMaintenanceDocs.mockResolvedValue(DOCS_RESPONSE);
});

describe('MaintenanceDocsTracker', () => {
  it('renders summary cards and evidence tables', async () => {
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText('Maintenance Docs Center')).toBeInTheDocument();
    });

    expect(screen.getAllByText('PAT Testing').length).toBeGreaterThan(0);
    expect(screen.getByText('Annual gas inspection')).toBeInTheDocument();
    expect(screen.getByText('Missing evidence')).toBeInTheDocument();
    expect(screen.getByText('Certificate expiring')).toBeInTheDocument();
    expect(screen.getByText('By Contractor')).toBeInTheDocument();
  });

  it('loads the active home instead of a stale stored home', async () => {
    api.getCurrentHome.mockReturnValue('old-home');
    renderAdmin({ activeHome: 'new-home' });

    await waitFor(() => {
      expect(api.getMaintenanceDocs).toHaveBeenCalledWith('new-home');
    });
  });

  it('shows a no-home state instead of hanging on the loading screen', async () => {
    api.getCurrentHome.mockReturnValue('');
    renderAdmin({ activeHome: '' });

    await waitFor(() => {
      expect(screen.getByText('No home selected')).toBeInTheDocument();
    });
    expect(api.getMaintenanceDocs).not.toHaveBeenCalled();
  });

  it('refreshes the docs center on demand', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Refresh/i }));

    await waitFor(() => {
      expect(api.getMaintenanceDocs).toHaveBeenCalledTimes(2);
    });
  });

  it('shows empty table states when there is no evidence data yet', async () => {
    api.getMaintenanceDocs.mockResolvedValue({
      summary: { total_checks: 0, missing_evidence_count: 0, expiring_count: 0, overdue_count: 0 },
      checks: [],
      byCategory: [],
      byContractor: [],
    });

    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText('No maintenance checks found')).toBeInTheDocument();
    });
    expect(screen.getByText('No category evidence yet')).toBeInTheDocument();
    expect(screen.getByText('No contractor evidence yet')).toBeInTheDocument();
  });
});
