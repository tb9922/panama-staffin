import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import HMRCDashboard from '../HMRCDashboard.jsx';
import { currentTaxYearForDate } from '../../lib/hmrcDates.js';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHMRCLiabilities: vi.fn(),
    getPayrollRuns: vi.fn(),
    markHMRCPaid: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

const MOCK_LIABILITIES = [
  {
    id: 'hmrc-1', tax_month: 1, tax_year: 2025,
    period_start: '2025-04-06', period_end: '2025-05-05',
    total_paye: '3200.00', total_employee_ni: '1800.00', total_employer_ni: '2100.00',
    total_due: '7100.00', payment_due_date: '2025-06-19',
    status: 'paid', paid_date: '2025-06-15', paid_reference: 'REF-001',
  },
  {
    id: 'hmrc-2', tax_month: 2, tax_year: 2025,
    period_start: '2025-05-06', period_end: '2025-06-05',
    total_paye: '3400.00', total_employee_ni: '1900.00', total_employer_ni: '2200.00',
    total_due: '7500.00', payment_due_date: '2025-07-19',
    status: 'unpaid', paid_date: null, paid_reference: null,
  },
];

function setupMocks(liabilities = MOCK_LIABILITIES, payrollRuns = []) {
  api.getHMRCLiabilities.mockResolvedValue(liabilities);
  api.getPayrollRuns.mockResolvedValue({ rows: payrollRuns, total: payrollRuns.length });
}

describe('HMRCDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
  });

  it('smoke test - renders without crashing', async () => {
    setupMocks();
    renderWithProviders(<HMRCDashboard />);
    await waitFor(() =>
      expect(screen.getByText('HMRC Liabilities')).toBeInTheDocument()
    );
  });

  it('shows loading state initially', () => {
    api.getHMRCLiabilities.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<HMRCDashboard />);
    expect(screen.getByText('Loading HMRC liabilities...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getHMRCLiabilities.mockRejectedValue(new Error('Forbidden'));
    renderWithProviders(<HMRCDashboard />);
    await waitFor(() =>
      expect(screen.getByText('Forbidden')).toBeInTheDocument()
    );
  });

  it('renders liabilities table with correct data', async () => {
    setupMocks();
    renderWithProviders(<HMRCDashboard />);
    await waitFor(() =>
      expect(screen.getByText('April')).toBeInTheDocument()
    );
    expect(screen.getByText('May')).toBeInTheDocument();
    // 'Paid' appears in both summary card label and status badge
    expect(screen.getAllByText('Paid').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Unpaid')).toBeInTheDocument();
    // Paid reference
    expect(screen.getByText('REF-001')).toBeInTheDocument();
  });

  it('renders summary cards', async () => {
    setupMocks();
    renderWithProviders(<HMRCDashboard />);
    await waitFor(() =>
      expect(screen.getByText('Total Due Year')).toBeInTheDocument()
    );
    expect(screen.getByText('Outstanding')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('shows table column headers', async () => {
    setupMocks();
    renderWithProviders(<HMRCDashboard />);
    await waitFor(() =>
      expect(screen.getByText('HMRC Liabilities')).toBeInTheDocument()
    );
    expect(screen.getByRole('columnheader', { name: 'Tax Month' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'PAYE' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Employee NI' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Employer NI' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Total Due' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
  });

  it('admin sees "Mark Paid" button for unpaid liabilities', async () => {
    setupMocks();
    renderWithProviders(<HMRCDashboard />);
    await waitFor(() =>
      expect(screen.getByText('April')).toBeInTheDocument()
    );
    // Only 1 Mark Paid button (the unpaid row), paid row shows dash
    const markPaidButtons = screen.getAllByRole('button', { name: 'Mark Paid' });
    expect(markPaidButtons.length).toBe(1);
  });

  it('viewer does not see "Mark Paid" button', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
    setupMocks();
    renderWithProviders(<HMRCDashboard />, { user: { username: 'viewer', role: 'viewer' }, canWrite: false });
    await waitFor(() =>
      expect(screen.getByText('April')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument();
  });

  it('shows empty state when no liabilities exist', async () => {
    setupMocks([]);
    renderWithProviders(<HMRCDashboard />);
    await waitFor(() =>
      expect(screen.getByText('HMRC Liabilities')).toBeInTheDocument()
    );
    expect(screen.getByText(/No HMRC liabilities/)).toBeInTheDocument();
  });

  it('shows RTI readiness alerts for approved payroll runs that are not exported', async () => {
    setupMocks(MOCK_LIABILITIES, [
      {
        id: 'run-1',
        status: 'approved',
        period_end: '2099-01-31',
        pay_date: '2020-01-31',
        exported_at: null,
      },
    ]);
    renderWithProviders(<HMRCDashboard />);
    await waitFor(() =>
      expect(screen.getByText(/past payday and still not exported/i)).toBeInTheDocument()
    );
  });

  it('does not show export-readiness alerts for draft or voided payroll runs', async () => {
    setupMocks(MOCK_LIABILITIES, [
      {
        id: 'run-draft',
        status: 'draft',
        period_end: '2099-01-31',
        pay_date: '2020-01-31',
        exported_at: null,
      },
      {
        id: 'run-voided',
        status: 'voided',
        period_end: '2099-01-31',
        pay_date: '2020-01-31',
        exported_at: null,
      },
    ]);
    renderWithProviders(<HMRCDashboard />);
    await waitFor(() =>
      expect(screen.getByText('HMRC Liabilities')).toBeInTheDocument()
    );
    expect(screen.queryByText(/past payday and still not exported/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/still needs fps\/export action/i)).not.toBeInTheDocument();
  });

  it('reads payroll runs from the paginated API shape used in production', async () => {
    api.getHMRCLiabilities.mockResolvedValue(MOCK_LIABILITIES);
    api.getPayrollRuns.mockResolvedValue({
      rows: [
        {
          id: 'run-1',
          status: 'approved',
          period_end: '2099-01-31',
          pay_date: '2020-01-31',
          exported_at: null,
        },
      ],
      total: 1,
    });

    renderWithProviders(<HMRCDashboard />);
    await waitFor(() =>
      expect(screen.getByText(/past payday and still not exported/i)).toBeInTheDocument()
    );
  });

  it('uses pay_date rather than period_end for RTI readiness alerts', async () => {
    setupMocks(MOCK_LIABILITIES, [
      {
        id: 'run-1',
        status: 'approved',
        period_end: '2020-01-31',
        pay_date: '2099-12-31',
        exported_at: null,
      },
    ]);
    renderWithProviders(<HMRCDashboard />);
    await waitFor(() =>
      expect(screen.getByText(/approved payroll run still needs fps\/export action/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/past payday and still not exported/i)).not.toBeInTheDocument();
  });

  it('loads additional payroll pages for RTI alerts when the first page is full', async () => {
    api.getHMRCLiabilities.mockResolvedValue(MOCK_LIABILITIES);
    api.getPayrollRuns
      .mockResolvedValueOnce({
        rows: Array.from({ length: 500 }, (_, index) => ({
          id: `run-${index}`,
          status: 'exported',
          period_end: '2099-01-31',
          pay_date: '2099-01-31',
          exported_at: '2099-02-01T09:00:00Z',
        })),
        total: 501,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'run-late',
            status: 'approved',
            period_end: '2099-01-31',
            pay_date: '2020-01-31',
            exported_at: null,
          },
        ],
        total: 501,
      });

    renderWithProviders(<HMRCDashboard />);
    await waitFor(() =>
      expect(screen.getByText(/past payday and still not exported/i)).toBeInTheDocument()
    );
    expect(api.getPayrollRuns).toHaveBeenNthCalledWith(1, 'test-home', { limit: 500, offset: 0 });
    expect(api.getPayrollRuns).toHaveBeenNthCalledWith(2, 'test-home', { limit: 500, offset: 500 });
  });

  it('shows a degraded warning when payroll runs cannot be loaded for RTI alerts', async () => {
    api.getHMRCLiabilities.mockResolvedValue(MOCK_LIABILITIES);
    api.getPayrollRuns.mockRejectedValue(new Error('runs down'));

    renderWithProviders(<HMRCDashboard />);
    await waitFor(() =>
      expect(screen.getByText(/RTI\/FPS readiness alerts are temporarily unavailable/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/past payday and still not exported/i)).not.toBeInTheDocument();
  });

  it('uses local year rather than UTC year when deriving the default tax year', () => {
    const fakeLocalDate = {
      getMonth: () => 0,
      getDate: () => 10,
      getFullYear: () => 2026,
      getUTCFullYear: () => 2025,
    };
    expect(currentTaxYearForDate(fakeLocalDate)).toBe(2025);
  });
});
