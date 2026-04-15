import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import FileAttachments from '../FileAttachments.jsx';
import { useData } from '../../contexts/DataContext.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getHrAttachments: vi.fn().mockResolvedValue([]),
    uploadHrAttachment: vi.fn(),
    deleteHrAttachment: vi.fn(),
    downloadHrAttachment: vi.fn(),
  };
});

describe('FileAttachments scan entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a contextual scan link for HR attachments', async () => {
    renderWithProviders(<FileAttachments caseType="disciplinary" caseId={42} />);
    await waitFor(() => expect(screen.getByText('No documents attached.')).toBeInTheDocument());
    const link = screen.getByRole('link', { name: 'Scan document' });
    expect(link.getAttribute('href')).toContain('/scan-inbox?');
    expect(link.getAttribute('href')).toContain('launchTarget=hr_attachment');
    expect(link.getAttribute('href')).toContain('caseType=disciplinary');
    expect(link.getAttribute('href')).toContain('caseId=42');
  });

  it('shows a contextual scan link for record attachments', async () => {
    renderWithProviders(<FileAttachments caseType="incident" caseId="INC-9" />);
    await waitFor(() => expect(screen.getByText('No documents attached.')).toBeInTheDocument());
    const link = screen.getByRole('link', { name: 'Scan document' });
    expect(link.getAttribute('href')).toContain('launchTarget=record_attachment');
    expect(link.getAttribute('href')).toContain('moduleId=incident');
    expect(link.getAttribute('href')).toContain('recordId=INC-9');
  });

  it('hides the scan link when scan intake is disabled for the home', async () => {
    useData.mockReturnValue({
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'home_manager',
      staffId: null,
      scanIntakeEnabled: false,
      scanIntakeTargets: [],
      isScanTargetEnabled: () => false,
    });
    renderWithProviders(<FileAttachments caseType="incident" caseId="INC-9" />);
    await waitFor(() => expect(screen.getByText('No documents attached.')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Scan document' })).not.toBeInTheDocument();
  });

  it('keeps scan available for first-pass CQC uploads that can create evidence on confirm', async () => {
    renderWithProviders(<FileAttachments caseType="cqc_evidence" ensureCaseId={vi.fn()} />);
    const link = screen.getByRole('link', { name: 'Scan document' });
    expect(link.getAttribute('href')).toContain('launchTarget=cqc');
  });
});
