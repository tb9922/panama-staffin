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
    getCqcReadiness: vi.fn(),
    getCqcNarratives: vi.fn(),
    createCqcEvidence: vi.fn(),
    updateCqcEvidence: vi.fn(),
    upsertCqcNarrative: vi.fn(),
    getCqcEvidenceFiles: vi.fn(),
    uploadCqcEvidenceFile: vi.fn(),
    deleteCqcEvidenceFile: vi.fn(),
    downloadCqcEvidenceFile: vi.fn(),
    deleteCqcEvidence: vi.fn(),
    logReportDownload: vi.fn(),
    createSnapshot: vi.fn(),
    getSnapshots: vi.fn(),
    getSnapshot: vi.fn(),
    signOffSnapshot: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

vi.mock('../../lib/pdfReports.js', () => ({
  generateEvidencePackPDF: vi.fn(),
}));

vi.mock('../../hooks/useLiveDate.js', () => ({
  useLiveDate: vi.fn(() => '2026-03-08'),
}));

import * as api from '../../lib/api.js';
import * as pdfReports from '../../lib/pdfReports.js';

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
  api.getCqcReadiness.mockResolvedValue({
    computedAt: '2026-03-08',
    entries: [
      {
        statementId: 'S1',
        statementName: 'Learning Culture',
        category: 'safe',
        status: 'partial',
        evidenceCount: 1,
        categoriesCovered: 1,
        categoriesExpected: 4,
        staleCount: 0,
        reviewOverdue: 0,
        narrativePresent: false,
        summary: '1 evidence item. Missing: observation, processes, outcomes.',
      },
    ],
    questionSummary: [
      { question: 'safe', total: 8, strong: 0, partial: 1, stale: 0, weak: 0, missing: 7 },
      { question: 'effective', total: 6, strong: 0, partial: 0, stale: 0, weak: 0, missing: 6 },
      { question: 'caring', total: 5, strong: 0, partial: 0, stale: 0, weak: 0, missing: 5 },
      { question: 'responsive', total: 5, strong: 0, partial: 0, stale: 0, weak: 0, missing: 5 },
      { question: 'well-led', total: 10, strong: 0, partial: 0, stale: 0, weak: 0, missing: 10 },
    ],
    gaps: [
      {
        statementId: 'S1',
        statementName: 'Learning Culture',
        category: 'safe',
        status: 'partial',
        summary: '1 evidence item. Missing: observation, processes, outcomes.',
      },
    ],
    overall: { band: 'gaps', label: 'Heuristic: Gaps', badge: 'amber', strong: 0, partial: 1, stale: 0, weak: 0, missing: 33, total: 34 },
  });
  api.getCqcNarratives.mockResolvedValue([]);
  api.createCqcEvidence.mockResolvedValue({
    id: 'ev-001',
    version: 0,
    quality_statement: 'S1',
    type: 'qualitative',
    title: 'Created evidence',
    description: 'Saved from modal',
    date_from: null,
    date_to: null,
    evidence_category: 'feedback',
    file_count: 0,
  });
  api.updateCqcEvidence.mockResolvedValue({
    id: 'ev-001',
    version: 1,
    quality_statement: 'S1',
    type: 'qualitative',
    title: 'Updated evidence',
    description: 'Saved from modal',
    date_from: null,
    date_to: null,
    evidence_category: 'feedback',
    file_count: 0,
  });
  api.getCqcEvidenceFiles.mockResolvedValue([]);
  api.upsertCqcNarrative.mockResolvedValue({
    quality_statement: 'S1',
    narrative: 'The evidence shows safer incident follow-up.',
    risks: 'Escalation recording can still be inconsistent.',
    actions: 'Refresh incident learning in team meetings.',
    reviewed_by: 'admin',
    reviewed_at: '2026-03-08T10:00:00Z',
    review_due: '2026-06-08',
    version: 1,
  });
  api.uploadCqcEvidenceFile.mockResolvedValue({});
  api.deleteCqcEvidenceFile.mockResolvedValue({});
  api.downloadCqcEvidenceFile.mockResolvedValue(undefined);
  api.deleteCqcEvidence.mockResolvedValue({});
  api.createSnapshot.mockResolvedValue({ id: 'snap-001' });
  api.getSnapshots.mockResolvedValue([]);
  api.getSnapshot.mockResolvedValue({ id: 'snap-001', status: 'draft' });
  api.signOffSnapshot.mockResolvedValue({});
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
      expect(screen.getAllByText('Safe').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Effective').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Caring').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Responsive').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Well-Led').length).toBeGreaterThan(0);
  });

  it('displays the Overall Score KPI card', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Overall Score')).toBeInTheDocument();
    });
  });

  it('shows the readiness strip and gap section after load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Readiness')).toBeInTheDocument();
    });
    expect(screen.getByText('Readiness Gaps')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.getCqcReadiness).toHaveBeenCalled();
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

  it('generates the evidence pack without surfacing a PDF error', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Generate Evidence Pack/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Generate Evidence Pack/i }));

    await waitFor(() => {
      expect(pdfReports.generateEvidencePackPDF).toHaveBeenCalled();
    });
    expect(screen.queryByText(/Failed to generate PDF/i)).not.toBeInTheDocument();
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

  it('saves a self-assessment narrative for a statement', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Learning Culture')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Learning Culture'));
    await user.type(screen.getByLabelText('What the evidence shows'), 'Learning is discussed in daily handover.');
    await user.click(screen.getByRole('button', { name: /Save Self-Assessment/i }));

    await waitFor(() => {
      expect(api.upsertCqcNarrative).toHaveBeenCalled();
    });
    expect(screen.getByText(/Self-assessment saved for S1/i)).toBeInTheDocument();
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

  it('shows a friendly notice and opens snapshot history when the same snapshot already exists', async () => {
    const user = userEvent.setup();
    api.createSnapshot.mockRejectedValueOnce(Object.assign(new Error('An identical snapshot already exists'), { status: 409 }));
    api.getSnapshots.mockResolvedValue([
      {
        id: 'snap-001',
        computed_at: '2026-03-08T10:00:00Z',
        overall_score: 88,
        band: 'Good',
        engine_version: 'v1',
        computed_by: 'admin',
        signed_off_by: null,
      },
    ]);

    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save Snapshot' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Save Snapshot' }));

    await waitFor(() => {
      expect(screen.getByText('This exact snapshot is already saved. Snapshot History has been opened below.')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Hide Snapshot History (1)' })).toBeInTheDocument();
    expect(screen.getByText('2026-03-08')).toBeInTheDocument();
  });

  it('exports snapshot PDFs from frozen snapshot data, not live metrics', async () => {
    const user = userEvent.setup();
    const frozenEvidencePack = { source: 'snapshot', rows: [{ file: 'frozen.pdf' }] };
    api.getSnapshots.mockResolvedValueOnce([
      {
        id: 'snap-100',
        computed_at: '2026-03-08T10:00:00Z',
        overall_score: 88,
        band: 'Good',
        engine_version: 'v2',
        computed_by: 'admin',
        signed_off_by: 'manager',
      },
    ]);
    api.getSnapshot.mockResolvedValueOnce({
      id: 'snap-100',
      computed_at: '2026-03-08T10:00:00Z',
      overall_score: 88,
      band: 'Good',
      engine_version: 'v2',
      signed_off_by: 'manager',
      result: {
        evidencePackData: frozenEvidencePack,
        evidencePackMeta: { date_range_days: 90 },
        questionScores: {},
      },
    });

    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show Snapshot History (1)' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Show Snapshot History (1)' }));
    await user.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Export PDF from Snapshot' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Export PDF from Snapshot' }));

    await waitFor(() => {
      expect(pdfReports.generateEvidencePackPDF).toHaveBeenCalledWith(
        frozenEvidencePack,
        90,
        expect.objectContaining({ id: 'snap-100' })
      );
    });
  });

  it('lets you upload supporting files on the first pass by auto-saving the evidence item', async () => {
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
      expect(screen.getByRole('heading', { name: 'Add Evidence Item' })).toBeInTheDocument();
    });

    expect(screen.getByText('Supporting Files')).toBeInTheDocument();
    expect(screen.getByText('You can upload on the first pass. We will save the evidence item automatically before the first file upload. Saving the evidence item alone does not attach the selected file — click Upload.')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Brief title...'), 'Family feedback summary');
    await user.upload(screen.getByLabelText('File'), new File(['hello'], 'evidence.txt', { type: 'text/plain' }));

    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(api.createCqcEvidence).toHaveBeenCalled();
      expect(api.uploadCqcEvidenceFile).toHaveBeenCalledWith('cqc_evidence', 'ev-001', expect.any(File), '');
    });
    expect(screen.getByText('Evidence saved. Uploading supporting files now.')).toBeInTheDocument();
    expect(screen.getByText('No supporting files uploaded yet.')).toBeInTheDocument();
    expect(api.getCqcEvidenceFiles).toHaveBeenCalledWith('cqc_evidence', 'ev-001');
  });

  it('shows manual evidence file counts so unsaved attachments are obvious', async () => {
    api.getCqcEvidence.mockResolvedValue({
      evidence: [{
        id: 'ev-101',
        version: 1,
        quality_statement: 'S1',
        type: 'qualitative',
        title: 'Family feedback summary',
        description: '',
        date_from: '2026-03-01',
        date_to: '2026-03-05',
        evidence_category: 'peoples_experience',
        evidence_owner: null,
        review_due: null,
        added_by: 'admin',
        added_at: '2026-03-06T10:00:00Z',
        file_count: 0,
      }],
    });

    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Learning Culture')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Learning Culture'));
    expect(await screen.findByText('0 files')).toBeInTheDocument();
  });
});
