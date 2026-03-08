import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IpcAuditTracker from '../IpcAuditTracker.jsx';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getIpcAudits: vi.fn(),
    createIpcAudit: vi.fn(),
    updateIpcAudit: vi.fn(),
    deleteIpcAudit: vi.fn(),
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

const MOCK_AUDIT_TYPES = [
  { id: 'hand-hygiene', name: 'Hand Hygiene', active: true },
  { id: 'ppe', name: 'PPE Compliance', active: true },
  { id: 'cleanliness', name: 'Environmental Cleanliness', active: true },
];

const MOCK_AUDITS = [
  {
    id: 'IPC-001',
    audit_date: '2026-02-15',
    audit_type: 'hand-hygiene',
    auditor: 'Jane Nurse',
    overall_score: 92,
    compliance_pct: 95,
    risk_areas: [],
    corrective_actions: [],
    outbreak: null,
    notes: 'Good compliance observed',
    reported_at: '2026-02-15T10:00:00Z',
    updated_at: '2026-02-15T10:00:00Z',
  },
  {
    id: 'IPC-002',
    audit_date: '2026-01-10',
    audit_type: 'ppe',
    auditor: 'John Manager',
    overall_score: 65,
    compliance_pct: 68,
    risk_areas: [{ area: 'Glove usage', severity: 'medium', details: 'Inconsistent usage observed' }],
    corrective_actions: [
      { description: 'Staff re-training', assigned_to: 'Team Lead', due_date: '2026-02-01', completed_date: '', status: 'completed' },
    ],
    outbreak: { suspected: true, type: 'Norovirus', status: 'suspected', start_date: '2026-01-08', end_date: '', affected_staff: 2, affected_residents: 3, measures: 'Isolation implemented' },
    notes: '',
    reported_at: '2026-01-10T09:00:00Z',
    updated_at: '2026-01-10T09:00:00Z',
  },
];

const MOCK_RESPONSE = {
  audits: MOCK_AUDITS,
  auditTypes: MOCK_AUDIT_TYPES,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<IpcAuditTracker />, { user: { username: 'admin', role: 'admin' } });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  return renderWithProviders(<IpcAuditTracker />, { user: { username: 'viewer', role: 'viewer' } });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getIpcAudits.mockResolvedValue(MOCK_RESPONSE);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IpcAuditTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading IPC audits/i) ||
        screen.queryByText('IPC Audit Tracker')
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getIpcAudits.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading IPC audits...')).toBeInTheDocument();
  });

  it('shows error message and retry button when API call fails', async () => {
    api.getIpcAudits.mockRejectedValue(new Error('Failed to load IPC audits'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Failed to load IPC audits')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders page heading and KPI stat cards after load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('IPC Audit Tracker')).toBeInTheDocument();
    });
    expect(screen.getByText('Avg Score')).toBeInTheDocument();
    expect(screen.getByText('Audits This Quarter')).toBeInTheDocument();
    expect(screen.getByText('Active Outbreaks')).toBeInTheDocument();
    expect(screen.getByText('Action Completion')).toBeInTheDocument();
  });

  it('renders audit rows in the table', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('2026-02-15')).toBeInTheDocument();
    });
    expect(screen.getByText('2026-01-10')).toBeInTheDocument();
    // Auditor names
    expect(screen.getByText('Jane Nurse')).toBeInTheDocument();
    expect(screen.getByText('John Manager')).toBeInTheDocument();
  });

  it('shows empty state when no audits exist', async () => {
    api.getIpcAudits.mockResolvedValue({ audits: [], auditTypes: MOCK_AUDIT_TYPES });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('No IPC audits recorded')).toBeInTheDocument();
    });
  });

  it('admin sees the + New Audit button', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ New Audit/i })).toBeInTheDocument();
    });
  });

  it('viewer does NOT see the + New Audit button', async () => {
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText('IPC Audit Tracker')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /\+ New Audit/i })).not.toBeInTheDocument();
  });

  it('outbreak badge is visible for audits with active outbreaks', async () => {
    renderAdmin();
    await waitFor(() => {
      // IPC-002 has suspected outbreak — 'Suspected' badge should appear
      expect(screen.getByText('Suspected')).toBeInTheDocument();
    });
  });

  it('clicking + New Audit opens a modal', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ New Audit/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /\+ New Audit/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('New IPC Audit')).toBeInTheDocument();
  });

  it('shows correct audit score badge in table', async () => {
    renderAdmin();
    await waitFor(() => {
      // IPC-001 score 92% — displayed as "92%"
      expect(screen.getByText('92%')).toBeInTheDocument();
    });
  });

  it('filter by audit type narrows table results', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText('Jane Nurse')).toBeInTheDocument();
    });

    // Filter to PPE only
    const typeSelect = screen.getByDisplayValue('All Types');
    await user.selectOptions(typeSelect, 'ppe');

    await waitFor(() => {
      // Jane Nurse (hand-hygiene) should disappear
      expect(screen.queryByText('Jane Nurse')).not.toBeInTheDocument();
      // John Manager (ppe) should remain
      expect(screen.getByText('John Manager')).toBeInTheDocument();
    });
  });
});
