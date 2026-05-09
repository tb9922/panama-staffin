import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import ExpenseTracker from '../ExpenseTracker.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getFinanceExpenses: vi.fn(),
    createFinanceExpense: vi.fn(),
    updateFinanceExpense: vi.fn(),
    approveFinanceExpense: vi.fn(),
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

const MOCK_EXPENSES = {
  rows: [
    {
      id: 'exp-1', expense_date: '2026-03-01', category: 'utilities',
      description: 'Electricity bill February', supplier: 'British Gas',
      net_amount: '450.00', vat_amount: '90.00', gross_amount: '540.00',
      status: 'pending', created_by: 'manager1', approved_by: null, approved_date: null, version: 3,
    },
    {
      id: 'exp-2', expense_date: '2026-02-15', category: 'maintenance',
      description: 'Boiler service', supplier: 'HeatingCo',
      net_amount: '200.00', vat_amount: '40.00', gross_amount: '240.00',
      status: 'approved', created_by: 'admin', approved_by: 'admin', approved_date: '2026-02-16', version: 2,
    },
  ],
  total: 2,
};

function setupMocks(data = MOCK_EXPENSES) {
  api.getFinanceExpenses.mockResolvedValue(data);
}

describe('ExpenseTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
    api.getRecordAttachments.mockResolvedValue([]);
  });

  it('smoke test - renders without crashing', async () => {
    setupMocks();
    renderWithProviders(<ExpenseTracker />);
    await waitFor(() =>
      expect(screen.getByText('Expenses')).toBeInTheDocument()
    );
  });

  it('shows loading state initially', () => {
    api.getFinanceExpenses.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ExpenseTracker />);
    expect(screen.getByText('Loading expenses...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getFinanceExpenses.mockRejectedValue(new Error('Access denied'));
    renderWithProviders(<ExpenseTracker />);
    await waitFor(() =>
      expect(screen.getByText('Access denied')).toBeInTheDocument()
    );
  });

  it('renders expenses table with correct data', async () => {
    setupMocks();
    renderWithProviders(<ExpenseTracker />);
    await waitFor(() =>
      expect(screen.getByText('Electricity bill February')).toBeInTheDocument()
    );
    expect(screen.getByText('Boiler service')).toBeInTheDocument();
    expect(screen.getByText('British Gas')).toBeInTheDocument();
    expect(screen.getByText('HeatingCo')).toBeInTheDocument();
    expect(screen.getByText('2026-03-01')).toBeInTheDocument();
    expect(screen.getByText('2026-02-15')).toBeInTheDocument();
  });

  it('renders table column headers', async () => {
    setupMocks();
    renderWithProviders(<ExpenseTracker />);
    await waitFor(() =>
      expect(screen.getByText('Expenses')).toBeInTheDocument()
    );
    expect(screen.getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Description' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Net' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Gross' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
  });

  it('admin sees "Add Expense" button', async () => {
    setupMocks();
    renderWithProviders(<ExpenseTracker />);
    await waitFor(() =>
      expect(screen.getByText('Expenses')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Add Expense' })).toBeInTheDocument();
  });

  it('viewer does not see "Add Expense" button', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
    setupMocks();
    renderWithProviders(<ExpenseTracker />, { user: { username: 'viewer', role: 'viewer' }, canWrite: false });
    await waitFor(() =>
      expect(screen.getByText('Expenses')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Add Expense' })).not.toBeInTheDocument();
  });

  it('shows empty state when no expenses exist', async () => {
    setupMocks({ rows: [], total: 0 });
    renderWithProviders(<ExpenseTracker />);
    await waitFor(() =>
      expect(screen.getByText('Expenses')).toBeInTheDocument()
    );
    expect(screen.getByText('No expenses found')).toBeInTheDocument();
  });

  it('does not hang or call the API when no home is selected', async () => {
    api.getCurrentHome.mockReturnValue(null);
    renderWithProviders(<ExpenseTracker />, { activeHome: null });

    await waitFor(() => expect(screen.getByText('No expenses found')).toBeInTheDocument());

    expect(screen.queryByText('Loading expenses...')).not.toBeInTheDocument();
    expect(api.getFinanceExpenses).not.toHaveBeenCalled();
  });

  it('shows expense count text', async () => {
    setupMocks();
    renderWithProviders(<ExpenseTracker />);
    await waitFor(() =>
      expect(screen.getByText('2 expenses')).toBeInTheDocument()
    );
  });

  it('Export Excel button triggers downloadXLSX', async () => {
    const user = userEvent.setup();
    setupMocks();
    renderWithProviders(<ExpenseTracker />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export Excel' })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: 'Export Excel' }));
    expect(downloadXLSX).toHaveBeenCalledOnce();
  });

  it('disables export when there are no rows', async () => {
    setupMocks({ rows: [], total: 0 });
    renderWithProviders(<ExpenseTracker />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Export Excel' })).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Export Excel' })).toBeDisabled();
  });

  it('shows export failures without crashing the page', async () => {
    const user = userEvent.setup();
    setupMocks();
    downloadXLSX.mockImplementationOnce(() => {
      throw new Error('Spreadsheet engine failed');
    });
    renderWithProviders(<ExpenseTracker />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Export Excel' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Export Excel' }));

    expect(await screen.findByText('Spreadsheet engine failed')).toBeInTheDocument();
    expect(screen.getByText('Expenses')).toBeInTheDocument();
  });

  it('keeps validation errors inside the add expense modal', async () => {
    const user = userEvent.setup();
    setupMocks();
    renderWithProviders(<ExpenseTracker />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Expense' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Add Expense' }));

    const dialog = screen.getByRole('dialog', { name: 'Add Expense' });
    await user.click(within(dialog).getByRole('button', { name: 'Add Expense' }));

    expect(await screen.findByText('Description and net amount are required.')).toBeInTheDocument();
    expect(api.createFinanceExpense).not.toHaveBeenCalled();
  });

  it('blocks negative expense amounts before calling the API', async () => {
    const user = userEvent.setup();
    setupMocks();
    renderWithProviders(<ExpenseTracker />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Expense' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Add Expense' }));
    await user.type(screen.getByLabelText('Description *'), 'Negative amount check');
    await user.clear(screen.getByLabelText('Net Amount *'));
    await user.type(screen.getByLabelText('Net Amount *'), '-10');
    await user.click(within(screen.getByRole('dialog', { name: 'Add Expense' })).getByRole('button', { name: 'Add Expense' }));

    expect(await screen.findByText('Net amount must be zero or more.')).toBeInTheDocument();
    expect(api.createFinanceExpense).not.toHaveBeenCalled();
  });

  it('approves expenses with the current optimistic-lock version', async () => {
    const user = userEvent.setup();
    setupMocks();
    api.approveFinanceExpense.mockResolvedValue({});
    renderWithProviders(<ExpenseTracker />);
    await waitFor(() =>
      expect(screen.getByText('Electricity bill February')).toBeInTheDocument()
    );

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(api.approveFinanceExpense).toHaveBeenCalledWith('test-home', 'exp-1', 3);
  });
});
