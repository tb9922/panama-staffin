import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RiskRegister from '../RiskRegister.jsx';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getRisks: vi.fn(),
    createRisk: vi.fn(),
    updateRisk: vi.fn(),
    deleteRisk: vi.fn(),
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

// A high open risk (L=4, I=4 → score 16 = critical)
const CRITICAL_RISK = {
  id: 'RISK-001',
  title: 'Insufficient Night Staffing',
  description: 'Night shift below minimum during winter',
  category: 'staffing',
  owner: 'Jane Manager',
  likelihood: 4,
  impact: 4,
  risk_score: 16,
  controls: [{ description: 'Agency on standby', effectiveness: 'partially_effective' }],
  residual_likelihood: 2,
  residual_impact: 3,
  residual_score: 6,
  actions: [
    { id: 'act-1', description: 'Recruit 2 night carers', owner: 'HR', due_date: '2026-04-01', status: 'open', completed_date: '' },
  ],
  last_reviewed: '2026-01-01',
  next_review: '2026-06-01',
  status: 'open',
};

// A low closed risk (L=1, I=2 → score 2 = low)
const LOW_CLOSED_RISK = {
  id: 'RISK-002',
  title: 'Outdated Fire Safety Manual',
  description: 'Manual not updated since 2023',
  category: 'compliance',
  owner: 'Fire Marshal',
  likelihood: 1,
  impact: 2,
  risk_score: 2,
  controls: [],
  residual_likelihood: 1,
  residual_impact: 1,
  residual_score: 1,
  actions: [],
  last_reviewed: '2026-02-01',
  next_review: '2026-12-01',
  status: 'closed',
};

const MOCK_RISKS_RESPONSE = {
  risks: [CRITICAL_RISK, LOW_CLOSED_RISK],
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<RiskRegister />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  return renderWithProviders(<RiskRegister />, {
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getRisks.mockResolvedValue(MOCK_RISKS_RESPONSE);
  api.getRecordAttachments.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RiskRegister', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading risk register/i) ||
        screen.queryByText(/Risk Register/i),
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getRisks.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading risk register...')).toBeInTheDocument();
  });

  it('displays error message when API call fails', async () => {
    api.getRisks.mockRejectedValue(new Error('Failed to fetch risks'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Failed to fetch risks')).toBeInTheDocument();
    });
  });

  it('displays the page heading and subtitle after load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Risk Register')).toBeInTheDocument();
    });
    expect(screen.getByText('CQC Regulation 17 — Governance & Management')).toBeInTheDocument();
  });

  it('shows stat card labels for open risks, critical, reviews overdue, actions overdue', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Total Open Risks')).toBeInTheDocument();
    });
    expect(screen.getByText('Critical Risks')).toBeInTheDocument();
    expect(screen.getByText('Reviews Overdue')).toBeInTheDocument();
    expect(screen.getByText('Actions Overdue')).toBeInTheDocument();
  });

  it('renders risk table rows with title, category, owner and score', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Insufficient Night Staffing')).toBeInTheDocument();
    });
    // Category is looked up from RISK_CATEGORIES: 'staffing' → 'Staffing'
    // Also appears as a filter dropdown option, so use getAllByText
    expect(screen.getAllByText('Staffing').length).toBeGreaterThan(0);
    expect(screen.getByText('Jane Manager')).toBeInTheDocument();
    // Score displayed as "N (LxI)" inside the band badge
    expect(screen.getByText('16 (4x4)')).toBeInTheDocument();
  });

  it('renders the 5x5 risk matrix heatmap', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Risk Matrix (Likelihood x Impact)')).toBeInTheDocument();
    });
    // Axis labels present
    expect(screen.getByText('LIKELIHOOD')).toBeInTheDocument();
    expect(screen.getByText('IMPACT')).toBeInTheDocument();
  });

  it('admin sees the + New Risk button', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ New Risk/i })).toBeInTheDocument();
    });
  });

  it('viewer does NOT see the + New Risk button', async () => {
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText('Risk Register')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /\+ New Risk/i })).not.toBeInTheDocument();
  });

  it('shows empty state when no risks exist', async () => {
    api.getRisks.mockResolvedValue({ risks: [] });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('No risks recorded')).toBeInTheDocument();
    });
  });

  it('shows risk count in the filter bar', async () => {
    renderAdmin();
    await waitFor(() => {
      // 2 risks in fixture but filter shows count of filtered list
      expect(screen.getByText(/\d+ risks/)).toBeInTheDocument();
    });
  });

  it('Export Excel button is present for all users', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export Excel/i })).toBeInTheDocument();
    });
  });

  it('shows risk evidence uploader for existing risks', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText('Insufficient Night Staffing')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Insufficient Night Staffing'));

    await waitFor(() => {
      expect(screen.getByText('Risk Evidence')).toBeInTheDocument();
    });
    expect(screen.getByText('No risk evidence uploaded yet.')).toBeInTheDocument();
  });
});
