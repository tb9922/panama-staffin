import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import CqcDocsTracker from '../CqcDocsTracker.jsx';

vi.mock('../../lib/api.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'stored-home'),
    getCqcDocs: vi.fn(),
  };
});

import { getCurrentHome, getCqcDocs } from '../../lib/api.js';

const payload = {
  summary: {
    total_documents: 2,
    missing_owner_count: 1,
    overdue_review_count: 1,
    missing_attachment_count: 1,
  },
  evidence: [
    {
      id: 'ev-1',
      quality_statement: 'S1',
      title: 'Leadership evidence',
      evidence_owner: '',
      review_due: '',
      missing_owner: true,
      missing_attachment: true,
      overdue_review: false,
    },
    {
      id: 'ev-2',
      quality_statement: 'S2',
      title: 'Policy evidence',
      evidence_owner: 'Registered Manager',
      review_due: '2026-06-01',
      missing_owner: false,
      missing_attachment: false,
      overdue_review: false,
    },
  ],
  byStatement: [{ key: 'S1', count: 1 }],
  byCategory: [{ key: 'Processes', count: 1 }],
  byOwner: [{ key: 'Registered Manager', count: 1 }],
};

describe('CqcDocsTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentHome.mockReturnValue('stored-home');
    getCqcDocs.mockResolvedValue(payload);
  });

  it('renders CQC document coverage without mojibake placeholders', async () => {
    renderWithProviders(<CqcDocsTracker />, { route: '/cqc/docs' });

    await waitFor(() => expect(screen.getByText('CQC Docs Center')).toBeInTheDocument());
    expect(getCqcDocs).toHaveBeenCalledWith('test-home');
    expect(screen.getByText('Leadership evidence')).toBeInTheDocument();
    expect(screen.getByText('No owner')).toBeInTheDocument();
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('â€”');
  });

  it('shows a no-home state instead of requesting docs with a blank home', () => {
    getCurrentHome.mockReturnValue(null);

    renderWithProviders(<CqcDocsTracker />, { route: '/cqc/docs', activeHome: '' });

    expect(screen.getByText('No home selected')).toBeInTheDocument();
    expect(screen.getByText('Select a home before opening the CQC docs center.')).toBeInTheDocument();
    expect(getCqcDocs).not.toHaveBeenCalled();
  });

  it('reloads docs with the Refresh button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CqcDocsTracker />, { route: '/cqc/docs' });

    await waitFor(() => expect(getCqcDocs).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: /^Refresh$/i }));

    await waitFor(() => expect(getCqcDocs).toHaveBeenCalledTimes(2));
  });
});
