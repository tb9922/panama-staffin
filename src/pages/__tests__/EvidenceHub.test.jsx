import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { within } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import EvidenceHub from '../EvidenceHub.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    searchEvidenceHub: vi.fn(),
    listEvidenceHubUploaders: vi.fn(),
    deleteEvidenceHubAttachment: vi.fn(),
    getEvidenceHubDownloadUrl: vi.fn((sourceModule, attachmentId) => `/api/${sourceModule}/${attachmentId}`),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

const HUB_ROWS = [
  {
    sourceModule: 'cqc_evidence',
    sourceLabel: 'CQC Evidence',
    sourceSubType: null,
    sourceRecordId: 'cqc-1',
    attachmentId: 44,
    originalName: 'family-feedback-note.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1536,
    description: 'Structured family feedback evidence',
    uploadedBy: 'compliance.user',
    createdAt: '2026-04-11T11:00:00.000Z',
    parentLabel: 'S1 - Learning culture audit',
    ownerPagePath: '/cqc',
    qualityStatementId: 'S1',
    evidenceCategory: 'partner_feedback',
    evidenceOwner: 'Compliance Lead',
    reviewDueAt: '2026-08-01',
    freshness: 'fresh',
    canDelete: true,
  },
  {
    sourceModule: 'hr',
    sourceLabel: 'HR Cases',
    sourceSubType: 'disciplinary',
    sourceRecordId: '12',
    attachmentId: 91,
    originalName: 'hr-evidence-note.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    description: 'HR disciplinary attachment',
    uploadedBy: 'hr.user',
    createdAt: '2026-04-10T11:00:00.000Z',
    parentLabel: 'Disciplinary - Late handover',
    staffName: 'Alice Evidence',
    ownerPagePath: '/hr/disciplinary',
    canDelete: true,
  },
  {
    sourceModule: 'record',
    sourceLabel: 'Operational Records',
    sourceSubType: 'finance_invoice',
    sourceRecordId: 'INV-42',
    attachmentId: 17,
    originalName: 'resident-invoice.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    description: 'Resident invoice pack',
    uploadedBy: 'finance.user',
    createdAt: '2026-04-10T10:00:00.000Z',
    parentLabel: 'Invoice - INV-42',
    staffName: null,
    ownerPagePath: '/finance/income',
    canDelete: false,
  },
];

describe('EvidenceHub page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    api.searchEvidenceHub.mockResolvedValue({ rows: HUB_ROWS, total: HUB_ROWS.length });
    api.listEvidenceHubUploaders.mockResolvedValue(['finance.user', 'hr.user']);
    api.deleteEvidenceHubAttachment.mockResolvedValue({ ok: true });
  });

  it('loads and renders hub rows', async () => {
    renderWithProviders(<EvidenceHub />, {
      user: { username: 'admin', role: 'admin' },
    });

    await waitFor(() => {
      expect(screen.getByText('Evidence Hub')).toBeInTheDocument();
    });
    expect(screen.getByText('family-feedback-note.pdf')).toBeInTheDocument();
    expect(screen.getByText('hr-evidence-note.pdf')).toBeInTheDocument();
    expect(screen.getByText('Invoice - INV-42')).toBeInTheDocument();
    expect(screen.getByText('Alice Evidence')).toBeInTheDocument();
    expect(screen.getByText('Feedback from Partners')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('passes module filters through to searchEvidenceHub', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EvidenceHub />, {
      user: { username: 'admin', role: 'admin' },
    });

    await waitFor(() => {
      expect(api.searchEvidenceHub).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: 'HR Cases' }));

    await waitFor(() => {
      expect(api.searchEvidenceHub).toHaveBeenLastCalledWith(expect.objectContaining({
        modules: ['hr'],
      }));
    });
  });

  it('only shows delete buttons for deletable rows and calls the delete API', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EvidenceHub />, {
      user: { username: 'admin', role: 'admin' },
    });

    await waitFor(() => {
      expect(screen.getByText('hr-evidence-note.pdf')).toBeInTheDocument();
    });

    const hrFileLink = screen.getByRole('link', { name: 'hr-evidence-note.pdf' });
    const hrRow = hrFileLink.closest('tr');
    expect(hrRow).not.toBeNull();

    const deleteButton = within(hrRow).getByRole('button', { name: 'Delete' });
    await user.click(deleteButton);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(api.deleteEvidenceHubAttachment).toHaveBeenCalledWith('hr', 91);
    });
  });

  it('renders the folder view with structured source and category groups', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EvidenceHub />, {
      user: { username: 'admin', role: 'admin' },
    });

    await waitFor(() => {
      expect(screen.getByText('Evidence Hub')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: 'Folders' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Toggle source CQC Evidence' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Toggle source HR Cases' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle category S1 - Learning Culture' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle source Onboarding' })).toBeInTheDocument();
    expect(screen.getAllByText('No folders currently match this source.').length).toBeGreaterThanOrEqual(1);
  });

  it('supports deleting a file from the folder view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EvidenceHub />, {
      user: { username: 'admin', role: 'admin' },
    });

    await waitFor(() => {
      expect(screen.getByText('Evidence Hub')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: 'Folders' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Toggle category Disciplinary' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Toggle category Disciplinary' }));

    await waitFor(() => {
      expect(screen.getByText('hr-evidence-note.pdf')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(api.deleteEvidenceHubAttachment).toHaveBeenCalledWith('hr', 91);
    });
  });

  it('can save and reapply Evidence Hub filters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EvidenceHub />, {
      user: { username: 'admin', role: 'admin' },
    });

    await waitFor(() => {
      expect(screen.getByText('Evidence Hub')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Search'), 'family');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'name');
    await user.click(screen.getByRole('button', { name: 'Save Filters' }));

    await user.click(screen.getByRole('button', { name: 'Clear Filters' }));
    await user.click(screen.getByRole('button', { name: 'Use Saved' }));

    expect(screen.getByLabelText('Search')).toHaveValue('family');
    expect(screen.getByLabelText('Sort by')).toHaveValue('name');
  });
});
