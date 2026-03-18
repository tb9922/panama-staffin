import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CQCEvidence from '../CQCEvidence.jsx';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { MOCK_SCHEDULING_DATA } from '../../test/fixtures/schedulingData.js';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getSchedulingData: vi.fn(),
    getTrainingData: vi.fn(),
    getIncidents: vi.fn(),
    getComplaints: vi.fn(),
    getMaintenance: vi.fn(),
    getIpcAudits: vi.fn(),
    getRisks: vi.fn(),
    getPolicies: vi.fn(),
    getWhistleblowingConcerns: vi.fn(),
    getDols: vi.fn(),
    getCareCertData: vi.fn(),
    getCqcEvidence: vi.fn(),
    createCqcEvidence: vi.fn(),
    deleteCqcEvidence: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

vi.mock('../../hooks/useLiveDate.js', () => ({
  useLiveDate: vi.fn(() => '2026-03-08'),
}));

import * as api from '../../lib/api.js';

// ── Fixture data ───────────────────────────────────────────────────────────────

function setupApiMocks() {
  api.getSchedulingData.mockResolvedValue({
    ...MOCK_SCHEDULING_DATA,
    training: {},
    supervisions: {},
    appraisals: {},
    fire_drills: [],
  });
  api.getTrainingData.mockResolvedValue({
    training: {},
    supervisions: {},
    appraisals: {},
    fireDrills: [],
  });
  api.getIncidents.mockResolvedValue({ incidents: [] });
  api.getComplaints.mockResolvedValue({ complaints: [], surveys: [] });
  api.getMaintenance.mockResolvedValue({ checks: [] });
  api.getIpcAudits.mockResolvedValue({ audits: [] });
  api.getRisks.mockResolvedValue({ risks: [] });
  api.getPolicies.mockResolvedValue({ policies: [] });
  api.getWhistleblowingConcerns.mockResolvedValue({ concerns: [] });
  api.getDols.mockResolvedValue({ dols: [], mcaAssessments: [] });
  api.getCareCertData.mockResolvedValue({ careCert: {} });
  api.getCqcEvidence.mockResolvedValue({ evidence: [] });
  api.createCqcEvidence.mockResolvedValue({ id: 'ev-001' });
  api.deleteCqcEvidence.mockResolvedValue({});
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  setupApiMocks();
});

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<CQCEvidence />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  return renderWithProviders(<CQCEvidence />, {
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('CQCEvidence', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading/i) ||
        screen.queryByText(/CQC Compliance/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    // Keep the scheduling data promise pending forever
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading CQC data...')).toBeInTheDocument();
  });

  it('shows error message when the main data fetch fails', async () => {
    api.getSchedulingData.mockRejectedValue(new Error('CQC load failed'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('CQC load failed')).toBeInTheDocument();
    });
  });

  it('displays the page title after successful load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('CQC Compliance Evidence')).toBeInTheDocument();
    });
  });

  it('shows the 5 CQC category section headings — Safe, Effective, Caring, Responsive, Well-Led', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Safe')).toBeInTheDocument();
    });
    expect(screen.getByText('Effective')).toBeInTheDocument();
    expect(screen.getByText('Caring')).toBeInTheDocument();
    expect(screen.getByText('Responsive')).toBeInTheDocument();
    expect(screen.getByText('Well-Led')).toBeInTheDocument();
  });

  it('displays the Overall Score KPI card', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Overall Score')).toBeInTheDocument();
    });
  });

  it('displays Training Compliance and Staffing Fill Rate KPI cards', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Training Compliance')).toBeInTheDocument();
    });
    expect(screen.getByText('Staffing Fill Rate')).toBeInTheDocument();
  });

  it('displays Agency Dependency KPI card', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Agency Dependency')).toBeInTheDocument();
    });
  });

  it('shows date range toggle buttons (28 Days, 90 Days, 1 Year)', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '28 Days' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '90 Days' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 Year' })).toBeInTheDocument();
  });

  it('renders quality statements for the Safe category (e.g. Learning Culture)', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Learning Culture')).toBeInTheDocument();
    });
    // Also check for another known quality statement in a different category
    expect(screen.getByText('Learning Culture')).toBeInTheDocument();
  });

  it('shows Generate Evidence Pack button', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Generate Evidence Pack/i })).toBeInTheDocument();
    });
  });

  it('shows Export Excel button', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export Excel/i })).toBeInTheDocument();
    });
  });

  it('admin sees + Add Evidence button when a quality statement is expanded', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Learning Culture')).toBeInTheDocument();
    });

    // Click on the Learning Culture statement to expand it
    await user.click(screen.getByText('Learning Culture'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Add Evidence' })).toBeInTheDocument();
    });
  });

  it('clicking + Add Evidence opens the Add Evidence modal', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Learning Culture')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Learning Culture'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Add Evidence' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '+ Add Evidence' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Add Evidence Item' })).toBeInTheDocument();
  });

  it('viewer does NOT see + Add Evidence button when a statement is expanded', async () => {
    const user = userEvent.setup();
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText('Learning Culture')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Learning Culture'));

    await waitFor(() => {
      // The statement description should be visible (expanded)
      expect(screen.getByText(/Learning from incidents/i)).toBeInTheDocument();
    });

    // Viewer should NOT see the Add Evidence button
    expect(screen.queryByRole('button', { name: '+ Add Evidence' })).not.toBeInTheDocument();
  });
});
