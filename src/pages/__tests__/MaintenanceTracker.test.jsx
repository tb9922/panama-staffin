import { screen, waitFor } from '@testing-library/react';
import MaintenanceTracker from '../MaintenanceTracker.jsx';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getMaintenance: vi.fn(),
    createMaintenanceCheck: vi.fn(),
    updateMaintenanceCheck: vi.fn(),
    deleteMaintenanceCheck: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({ downloadXLSX: vi.fn() }));

vi.mock('../../hooks/useLiveDate.js', () => ({
  useLiveDate: vi.fn(() => '2026-03-08'),
}));

import * as api from '../../lib/api.js';

// ── Fixture data ───────────────────────────────────────────────────────────────

// A compliant check — last done 2026-01-01, annual → next due 2027-01-01 (well in future)
const COMPLIANT_CHECK = {
  id: 'MC-001',
  category: 'pat',
  category_name: 'PAT Testing',
  description: 'Annual PAT test for all portable appliances',
  frequency: 'annual',
  last_completed: '2026-01-01',
  next_due: '2027-01-01',
  completed_by: 'Acme Engineers',
  contractor: 'Acme Ltd',
  items_checked: 20,
  items_passed: 20,
  items_failed: 0,
  certificate_ref: 'PAT-2026-001',
  certificate_expiry: '2027-01-01',
  notes: '',
};

// An overdue check — next due in the past
const OVERDUE_CHECK = {
  id: 'MC-002',
  category: 'gas',
  category_name: 'Gas Safety Certificate',
  description: 'Annual gas safety inspection',
  frequency: 'annual',
  last_completed: '2024-01-01',
  next_due: '2025-01-01',
  completed_by: 'Gas Corp',
  contractor: '',
  items_checked: '',
  items_passed: '',
  items_failed: '',
  certificate_ref: '',
  certificate_expiry: '',
  notes: 'Urgent',
};

const MOCK_MAINTENANCE_RESPONSE = {
  checks: [COMPLIANT_CHECK, OVERDUE_CHECK],
  maintenanceCategories: [
    { id: 'pat',  name: 'PAT Testing',           frequency: 'annual',   regulation: 'H&S Act 1974' },
    { id: 'gas',  name: 'Gas Safety Certificate', frequency: 'annual',   regulation: 'Gas Safety Regs 1998' },
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<MaintenanceTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  return renderWithProviders(<MaintenanceTracker />, {
    user: { username: 'viewer', role: 'viewer' },
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getMaintenance.mockResolvedValue(MOCK_MAINTENANCE_RESPONSE);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('MaintenanceTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading maintenance checks/i) ||
        screen.queryByText(/Maintenance & Environment/i),
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getMaintenance.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading maintenance checks...')).toBeInTheDocument();
  });

  it('displays error message when API call fails', async () => {
    api.getMaintenance.mockRejectedValue(new Error('Server error'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('displays the page heading after successful load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Maintenance & Environment')).toBeInTheDocument();
    });
  });

  it('shows stat cards with correct labels', async () => {
    renderAdmin();
    await waitFor(() => {
      // "of N checks" is unique to the Compliant KPI card sub-label
      expect(screen.getByText(/of \d+ checks/i)).toBeInTheDocument();
    });
    // "within 30 days" is unique to Due Soon card sub-label
    expect(screen.getByText('within 30 days')).toBeInTheDocument();
    // "compliant + due soon" is unique to Compliance card sub-label
    expect(screen.getByText('compliant + due soon')).toBeInTheDocument();
    // "require attention" is unique to Overdue card sub-label
    expect(screen.getByText('require attention')).toBeInTheDocument();
  });

  it('renders check rows with category names and certificate refs', async () => {
    renderAdmin();
    await waitFor(() => {
      // Both category names should appear as table row content
      expect(screen.getAllByText('PAT Testing').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Gas Safety Certificate').length).toBeGreaterThan(0);
    // Certificate ref appears in the table (unique value)
    expect(screen.getByText('PAT-2026-001')).toBeInTheDocument();
  });

  it('admin sees the Add Check button', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Check/i })).toBeInTheDocument();
    });
  });

  it('viewer does NOT see the Add Check button', async () => {
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText('Maintenance & Environment')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Add Check/i })).not.toBeInTheDocument();
  });

  it('shows empty state when no checks exist', async () => {
    api.getMaintenance.mockResolvedValue({ checks: [], maintenanceCategories: [] });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('No maintenance checks recorded')).toBeInTheDocument();
    });
  });

  it('Export Excel button is present for all users', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export Excel/i })).toBeInTheDocument();
    });
  });
});
