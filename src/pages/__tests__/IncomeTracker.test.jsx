import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import IncomeTracker from '../IncomeTracker.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getFinanceResidents: vi.fn(),
    createFinanceResident: vi.fn(),
    updateFinanceResident: vi.fn(),
    getFinanceFeeHistory: vi.fn(),
    getFinanceInvoices: vi.fn(),
    createFinanceInvoice: vi.fn(),
    updateFinanceInvoice: vi.fn(),
    recordFinancePayment: vi.fn(),
    getFinanceInvoice: vi.fn(),
    getRecordAttachments: vi.fn(),
    uploadRecordAttachment: vi.fn(),
    deleteRecordAttachment: vi.fn(),
    downloadRecordAttachment: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';
import { downloadXLSX } from '../../lib/excel.js';

const MOCK_RESIDENTS = {
  rows: [
    {
      id: 1, resident_name: 'Mrs Joan Smith', room_number: '101',
      care_type: 'residential', funding_type: 'self_funded',
      weekly_fee: 950, status: 'active', next_fee_review: '2026-06-01',
      outstanding_balance: 200, last_payment_date: '2026-03-01', last_payment_amount: 950,
      version: 1,
    },
    {
      id: 2, resident_name: 'Mr Albert Jones', room_number: '102',
      care_type: 'nursing', funding_type: 'la_funded',
      weekly_fee: 1200, status: 'active', next_fee_review: null,
      outstanding_balance: 0, last_payment_date: null, last_payment_amount: null,
      version: 1,
    },
  ],
  total: 2,
};

const MOCK_INVOICES = {
  rows: [
    {
      id: 10, invoice_number: 'INV-001', payer_name: 'Mrs Joan Smith', payer_type: 'resident',
      period_start: '2026-03-01', period_end: '2026-03-31',
      total_amount: 4100, amount_paid: 2000, balance_due: 2100, status: 'sent', due_date: '2026-04-15',
      version: 1,
    },
  ],
  total: 1,
};

function setupMocks() {
  api.getFinanceResidents.mockResolvedValue(MOCK_RESIDENTS);
  api.getFinanceInvoices.mockResolvedValue(MOCK_INVOICES);
  api.getFinanceInvoice.mockResolvedValue({ ...MOCK_INVOICES.rows[0], lines: [
    { id: 100, description: 'Residential fees', quantity: 1, unit_price: 4100, amount: 4100, line_type: 'fee' },
  ] });
  api.getFinanceFeeHistory.mockResolvedValue([]);
  api.getRecordAttachments.mockResolvedValue([]);
}

function renderAdmin() {
  setupMocks();
  return renderWithProviders(<IncomeTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  setupMocks();
  return renderWithProviders(<IncomeTracker />, {
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

describe('IncomeTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getCurrentHome.mockReturnValue('test-home');
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  });

  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Income & Billing')).toBeInTheDocument()
    );
  });

  it('shows loading text initially', () => {
    api.getFinanceResidents.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<IncomeTracker />);
    expect(screen.getByText('Loading residents...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getFinanceResidents.mockRejectedValue(new Error('Network error'));
    renderWithProviders(<IncomeTracker />);
    await waitFor(() =>
      expect(screen.getByText('Network error')).toBeInTheDocument()
    );
  });

  it('renders residents table with data after load', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Mrs Joan Smith')).toBeInTheDocument()
    );
    expect(screen.getByText('Mr Albert Jones')).toBeInTheDocument();
    expect(screen.getByText('101')).toBeInTheDocument();
    expect(screen.getByText('102')).toBeInTheDocument();
  });

  it('shows Add Resident button for admin', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Resident' })).toBeInTheDocument()
    );
  });

  it('hides Add Resident button for viewer', async () => {
    renderViewer();
    await waitFor(() =>
      expect(screen.getByText('Mrs Joan Smith')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Add Resident' })).not.toBeInTheDocument();
  });

  it('renders tab buttons for Residents and Invoices', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Income & Billing')).toBeInTheDocument()
    );
    expect(screen.getByRole('tab', { name: 'Residents' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Invoices' })).toBeInTheDocument();
  });

  it('switches to invoices tab and shows invoice table', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Invoices' })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('tab', { name: 'Invoices' }));
    await waitFor(() =>
      expect(screen.getByText('INV-001')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'New Invoice' })).toBeInTheDocument();
  });

  it('shows resident detail tabs in the resident edit modal', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Mrs Joan Smith')).toBeInTheDocument()
    );
    await user.click(screen.getByText('Mrs Joan Smith'));
    await waitFor(() =>
      expect(screen.getByText('Edit Resident')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Fee History' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument();
  });

  it('does not spin forever when no home is selected', async () => {
    const user = userEvent.setup();
    api.getCurrentHome.mockReturnValue(null);
    setupMocks();
    renderWithProviders(<IncomeTracker />);

    await waitFor(() => expect(screen.getByText('No billing residents found')).toBeInTheDocument());
    expect(screen.queryByText('Loading residents...')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Invoices' }));
    await waitFor(() => expect(screen.getByText('No invoices found')).toBeInTheDocument());
    expect(screen.queryByText('Loading invoices...')).not.toBeInTheDocument();
  });

  it('shows resident validation inside the modal', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Mrs Joan Smith')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Add Resident' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Resident' });
    await user.click(within(dialog).getByRole('button', { name: 'Add Resident' }));

    expect(screen.getByText('Resident name is required.')).toBeInTheDocument();
    expect(api.createFinanceResident).not.toHaveBeenCalled();
  });

  it('does not open an editable invoice when full invoice loading fails', async () => {
    const user = userEvent.setup();
    renderAdmin();
    api.getFinanceInvoice.mockRejectedValue(new Error('Invoice detail failed'));

    await user.click(screen.getByRole('tab', { name: 'Invoices' }));
    await waitFor(() => expect(screen.getByText('INV-001')).toBeInTheDocument());
    await user.click(screen.getByText('INV-001'));

    await waitFor(() => expect(screen.getByText('Invoice detail failed')).toBeInTheDocument());
    expect(screen.queryByText('Invoice INV-001')).not.toBeInTheDocument();
    expect(api.updateFinanceInvoice).not.toHaveBeenCalled();
  });

  it('validates invoice lines before saving', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await user.click(screen.getByRole('tab', { name: 'Invoices' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'New Invoice' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'New Invoice' }));
    await user.type(screen.getByLabelText('Payer Name *'), 'County Council');
    await user.click(screen.getByRole('button', { name: 'Create Invoice' }));

    expect(screen.getByText('Every invoice line needs a description.')).toBeInTheDocument();
    expect(api.createFinanceInvoice).not.toHaveBeenCalled();
  });

  it('exports resident rows once', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Mrs Joan Smith')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Export Excel' }));

    await waitFor(() => expect(downloadXLSX).toHaveBeenCalledTimes(1));
    expect(downloadXLSX).toHaveBeenCalledWith(
      'finance_residents.xlsx',
      expect.arrayContaining([expect.objectContaining({ name: 'Residents' })]),
    );
  });
});
