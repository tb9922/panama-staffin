import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import FinanceDocsTracker from '../FinanceDocsTracker.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getFinanceDocs: vi.fn(),
    downloadRecordAttachment: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

const MOCK_DOCS = {
  summary: {
    total_documents: 1,
    approved_without_document: 2,
    pending_too_long: 1,
    processed_without_source: 0,
  },
  documents: [{
    type: 'expense',
    parent_id: 'exp-1',
    supplier: 'Acme Care Supplies',
    month: '2026-05',
    category: 'medical_supplies',
    status: 'approved',
    attachment: { id: 'att-1', original_name: 'invoice.pdf' },
  }],
  expenses: [{
    id: 'exp-1',
    expense_date: '2026-05-02',
    supplier_name: 'Acme Care Supplies',
    description: 'Clinical supplies',
    gross_amount: 120,
    approved_without_document: false,
    pending_too_long: false,
  }],
  byMonth: [{ key: '2026-05', count: 1 }],
  bySupplier: [{ key: 'Acme Care Supplies', count: 1 }],
};

describe('FinanceDocsTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getCurrentHome.mockReturnValue('test-home');
    api.getFinanceDocs.mockResolvedValue(MOCK_DOCS);
    api.downloadRecordAttachment.mockResolvedValue();
  });

  it('renders summary, document tables, and grouping tables', async () => {
    renderWithProviders(<FinanceDocsTracker />);

    expect(await screen.findByText('Finance Docs Center')).toBeInTheDocument();
    expect(screen.getByText('Approved Without Document')).toBeInTheDocument();
    expect(screen.getByText('Pending Too Long')).toBeInTheDocument();
    expect(screen.getByText('Processed Without Source')).toBeInTheDocument();
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
    expect(screen.getAllByText('Acme Care Supplies').length).toBeGreaterThan(1);
    expect(screen.getByText('Clinical supplies')).toBeInTheDocument();
  });

  it('does not call the API when no home is selected', async () => {
    api.getCurrentHome.mockReturnValue(null);
    renderWithProviders(<FinanceDocsTracker />, { activeHome: null });

    expect(await screen.findByText('No finance documents have been attached yet.')).toBeInTheDocument();
    expect(screen.queryByText('Loading finance documents...')).not.toBeInTheDocument();
    expect(api.getFinanceDocs).not.toHaveBeenCalled();
  });

  it('refreshes the finance docs center', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FinanceDocsTracker />);

    await screen.findByText('invoice.pdf');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(api.getFinanceDocs).toHaveBeenCalledTimes(2));
  });

  it('downloads finance document attachments', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FinanceDocsTracker />);

    await user.click(await screen.findByRole('button', { name: 'invoice.pdf' }));

    expect(api.downloadRecordAttachment).toHaveBeenCalledWith('att-1', 'invoice.pdf');
  });

  it('shows download failures without leaving the page', async () => {
    const user = userEvent.setup();
    api.downloadRecordAttachment.mockRejectedValueOnce(new Error('Download failed'));
    renderWithProviders(<FinanceDocsTracker />);

    await user.click(await screen.findByRole('button', { name: 'invoice.pdf' }));

    expect(await screen.findByText('Download failed')).toBeInTheDocument();
    expect(screen.getByText('Finance Docs Center')).toBeInTheDocument();
  });

  it('handles sparse API payloads without crashing', async () => {
    api.getFinanceDocs.mockResolvedValueOnce({ summary: { total_documents: 0 } });
    renderWithProviders(<FinanceDocsTracker />);

    expect(await screen.findByText('No finance documents have been attached yet.')).toBeInTheDocument();
    expect(screen.getByText('No expense gaps to review.')).toBeInTheDocument();
  });
});
