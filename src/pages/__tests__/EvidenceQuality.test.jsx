import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import EvidenceQuality from '../EvidenceQuality.jsx';

vi.mock('../../lib/evidenceQualityApi.js', () => ({
  getEvidenceQuality: vi.fn(),
}));

import { getEvidenceQuality } from '../../lib/evidenceQualityApi.js';

const payload = {
  generated_at: '2026-05-04T09:00:00.000Z',
  heuristic: { label: 'Deterministic evidence quality heuristic' },
  summary: {
    score: 64,
    rag: 'amber',
    evidence_count: 3,
    statement_count: 2,
    red_statement_count: 1,
    amber_statement_count: 1,
    green_statement_count: 0,
  },
  domains: [
    { domain: 'safe', domain_label: 'Safe', score: 42, rag: 'red', red_count: 1, amber_count: 0 },
    { domain: 'effective', domain_label: 'Effective', score: 71, rag: 'amber', red_count: 0, amber_count: 1 },
  ],
  weakest_statements: [
    {
      statement_id: 'S2',
      statement_name: 'Safe Systems, Pathways & Transitions',
      domain_label: 'Safe',
      score: 20,
      rag: 'red',
      evidence_count: 1,
      weakest_reasons: ['No attachment or source link', 'No evidence owner'],
    },
    {
      statement_id: 'E1',
      statement_name: 'Assessing Needs',
      domain_label: 'Effective',
      score: 71,
      rag: 'amber',
      evidence_count: 2,
      weakest_reasons: ['Review due within 30 days'],
    },
  ],
  practical_gaps: [
    {
      statement_id: 'S2',
      statement_name: 'Safe Systems, Pathways & Transitions',
      domain: 'safe',
      domain_label: 'Safe',
      score: 20,
      rag: 'red',
      reason: 'No attachment or source link',
    },
  ],
};

describe('EvidenceQuality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('currentHome', 'home-1');
    getEvidenceQuality.mockResolvedValue(payload);
  });

  it('renders overall score, weakest statements and practical gaps', async () => {
    renderWithProviders(<EvidenceQuality />, { route: '/evidence-quality' });

    await waitFor(() => expect(screen.getByText('Evidence Quality')).toBeInTheDocument());
    expect(screen.getByText('64')).toBeInTheDocument();
    expect(screen.getAllByText('S2 - Safe Systems, Pathways & Transitions').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No attachment or source link').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Filter by CQC domain')).toBeInTheDocument();
  });

  it('shows a no-home state instead of falling through to the API fallback', () => {
    renderWithProviders(<EvidenceQuality />, { route: '/evidence-quality', activeHome: '' });

    expect(screen.getByText('No home selected')).toBeInTheDocument();
    expect(screen.getByText('Select a home before opening the evidence quality dashboard.')).toBeInTheDocument();
    expect(getEvidenceQuality).not.toHaveBeenCalled();
  });

  it('refreshes the current filtered dashboard on demand', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EvidenceQuality />, { route: '/evidence-quality' });

    await waitFor(() => expect(getEvidenceQuality).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: /^Refresh$/i }));

    await waitFor(() => expect(getEvidenceQuality).toHaveBeenCalledTimes(2));
    expect(getEvidenceQuality).toHaveBeenLastCalledWith(expect.objectContaining({ home: 'test-home' }), expect.any(Object));
  });

  it('reloads when filters change', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EvidenceQuality />, { route: '/evidence-quality' });

    await waitFor(() => expect(getEvidenceQuality).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getByLabelText('Filter by CQC domain'), 'safe');

    await waitFor(() => expect(getEvidenceQuality).toHaveBeenCalledTimes(2));
    expect(getEvidenceQuality).toHaveBeenLastCalledWith(expect.objectContaining({ domain: 'safe' }), expect.any(Object));
  });
});
