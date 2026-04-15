import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import FileAttachments from '../FileAttachments.jsx';

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
});
