import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    expect(screen.getByText('hr-evidence-note.pdf')).toBeInTheDocument();
    expect(screen.getByText('Invoice - INV-42')).toBeInTheDocument();
    expect(screen.getByText('Alice Evidence')).toBeInTheDocument();
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

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    expect(deleteButtons).toHaveLength(1);

    await user.click(deleteButtons[0]);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(api.deleteEvidenceHubAttachment).toHaveBeenCalledWith('hr', 91);
    });
  });
});
