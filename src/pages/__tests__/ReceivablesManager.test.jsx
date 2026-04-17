import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import ReceivablesManager from '../ReceivablesManager.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getReceivablesDetail: vi.fn(),
    getInvoiceChases: vi.fn(),
    createInvoiceChase: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

const MOCK_RECEIVABLES = {
  total_outstanding: 8500,
  buckets: {
    current: 3000,
    days_1_30: 2500,
    days_31_60: 1500,
    days_61_90: 1000,
    days_90_plus: 500,
  },
  overdue_items: [
    {
      id: 10, invoice_number: 'INV-001', payer_name: 'Mrs Joan Smith', payer_type: 'resident',
      total_amount: 4100, amount_paid: 1000, outstanding: 3100, due_date: '2026-02-15',
      days_overdue: 21, last_chase: { chase_date: '2026-03-01', method: 'phone', next_action_date: '2026-03-10' },
    },
    {
      id: 11, invoice_number: 'INV-002', payer_name: 'County Council', payer_type: 'local_authority',
      total_amount: 12000, amount_paid: 6000, outstanding: 6000, due_date: '2026-01-31',
      days_overdue: 36, last_chase: null,
    },
  ],
  chases_due: [],
};

function setupMocks(data = MOCK_RECEIVABLES) {
  api.getReceivablesDetail.mockResolvedValue(data);
  api.getInvoiceChases.mockResolvedValue([]);
}

function renderAdmin(data) {
  setupMocks(data);
  return renderWithProviders(<ReceivablesManager />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer(data) {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  setupMocks(data);
  return renderWithProviders(<ReceivablesManager />, {
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

describe('ReceivablesManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  });

  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Receivables')).toBeInTheDocument()
    );
  });

  it('shows loading text initially', () => {
    api.getReceivablesDetail.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ReceivablesManager />);
    expect(screen.getByText('Loading receivables and chase history...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getReceivablesDetail.mockRejectedValue(new Error('Access denied'));
    renderWithProviders(<ReceivablesManager />);
    await waitFor(() =>
      expect(screen.getByText('Access denied')).toBeInTheDocument()
    );
  });

  it('renders ageing bucket cards with totals', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Total Outstanding')).toBeInTheDocument()
    );
    // Bucket labels appear in both the ageing cards and the filter dropdown,
    // so use getAllByText to verify they're rendered (card + dropdown = 2 each)
    expect(screen.getAllByText('Current').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('1-30 days').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('31-60 days').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('61-90 days').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('90+ days').length).toBeGreaterThanOrEqual(2);
  });

  it('renders outstanding invoices table with data', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('INV-001')).toBeInTheDocument()
    );
    expect(screen.getByText('Mrs Joan Smith')).toBeInTheDocument();
    expect(screen.getByText('INV-002')).toBeInTheDocument();
    expect(screen.getByText('County Council')).toBeInTheDocument();
  });

  it('shows "No outstanding invoices" when empty', async () => {
    setupMocks({ total_outstanding: 0, buckets: {}, overdue_items: [], chases_due: [] });
    renderWithProviders(<ReceivablesManager />);
    await waitFor(() =>
      expect(screen.getByText('No outstanding invoices')).toBeInTheDocument()
    );
  });

  it('shows chase follow-ups banner when chases are due', async () => {
    const dataWithChases = { ...MOCK_RECEIVABLES, chases_due: [{ id: 1 }, { id: 2 }] };
    setupMocks(dataWithChases);
    renderWithProviders(<ReceivablesManager />);
    await waitFor(() =>
      expect(screen.getByText(/2 chase follow-ups due today or overdue/)).toBeInTheDocument()
    );
  });

  it('viewer cannot see Record Chase button in modal', async () => {
    const user = userEvent.setup();
    renderViewer();
    await waitFor(() =>
      expect(screen.getByText('INV-001')).toBeInTheDocument()
    );
    await user.click(screen.getByText('INV-001'));
    await waitFor(() =>
      expect(screen.getByText('Chase History')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Record Chase' })).not.toBeInTheDocument();
  });

  it('lets admins log the same chase against multiple selected invoices', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('INV-001')).toBeInTheDocument()
    );

    await user.click(screen.getByLabelText('Select invoice INV-001'));
    await user.click(screen.getByLabelText('Select invoice INV-002'));
    await user.click(screen.getByRole('button', { name: 'Log chase on 2 selected' }));

    await user.selectOptions(screen.getByLabelText('Method *'), 'email');
    await user.click(screen.getByRole('button', { name: 'Log chase on 2' }));

    await waitFor(() => {
      expect(api.createInvoiceChase).toHaveBeenCalledTimes(2);
    });
  });
});
