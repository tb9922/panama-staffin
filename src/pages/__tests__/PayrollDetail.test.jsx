import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import PayrollDetail from '../PayrollDetail.jsx';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: vi.fn(() => ({ runId: 'run-1' })),
  };
});

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getPayrollRun: vi.fn(),
    calculatePayrollRun: vi.fn(),
    approvePayrollRun: vi.fn(),
    getPayrollExportUrl: vi.fn(() => '/api/payroll/export'),
    getPayrollSummaryPdfUrl: vi.fn(() => '/api/payroll/summary.pdf'),
    getPayslips: vi.fn(),
    getSchedulingData: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import * as api from '../../lib/api.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_SCHED_DATA = {
  staff: [
    { id: 'S001', name: 'Alice Smith', role: 'Senior Carer', team: 'Day A', active: true, contract_hours: 36 },
    { id: 'S002', name: 'Bob Jones', role: 'Carer', team: 'Day B', active: true, contract_hours: 36 },
  ],
  overrides: {},
  config: {
    cycle_start_date: '2025-01-06',
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
    bank_holidays: [],
  },
};

const MOCK_DRAFT_RUN = {
  run: {
    id: 'run-1',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    pay_frequency: 'monthly',
    status: 'draft',
    staff_count: 2,
    total_gross: null,
    total_enhancements: null,
    approved_by: null,
    exported_at: null,
    notes: null,
  },
  lines: [],
};

const MOCK_LINES = [
  {
    staff_id: 'S001',
    base_hours: '160.00', base_pay: '2320.00',
    night_enhancement: '0.00', weekend_enhancement: '0.00',
    bank_holiday_enhancement: '0.00', overtime_enhancement: '0.00',
    sleep_in_pay: '0.00', on_call_enhancement: '0.00',
    total_hours: '160.00', gross_pay: '2320.00',
    holiday_pay: '0.00', ssp_amount: '0.00',
    tax_deducted: '232.00', employee_ni: '140.00',
    employer_ni: '180.00', pension_employee: '50.00',
    student_loan: '0.00', net_pay: '1898.00',
    nmw_compliant: true,
  },
  {
    staff_id: 'S002',
    base_hours: '160.00', base_pay: '2000.00',
    night_enhancement: '100.00', weekend_enhancement: '0.00',
    bank_holiday_enhancement: '0.00', overtime_enhancement: '0.00',
    sleep_in_pay: '0.00', on_call_enhancement: '0.00',
    total_hours: '160.00', gross_pay: '2100.00',
    holiday_pay: '0.00', ssp_amount: '0.00',
    tax_deducted: '200.00', employee_ni: '120.00',
    employer_ni: '160.00', pension_employee: '40.00',
    student_loan: '0.00', net_pay: '1740.00',
    nmw_compliant: true,
  },
];

const MOCK_CALCULATED_RUN = {
  run: {
    ...MOCK_DRAFT_RUN.run,
    status: 'calculated',
    total_gross: '4420.00',
    total_enhancements: '100.00',
  },
  lines: MOCK_LINES,
};

const MOCK_APPROVED_RUN = {
  run: {
    ...MOCK_CALCULATED_RUN.run,
    status: 'approved',
    approved_by: 'admin',
  },
  lines: MOCK_LINES,
};

function setupMocks(runData = MOCK_CALCULATED_RUN) {
  api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
  api.getPayrollRun.mockResolvedValue(runData);
  api.getPayslips.mockResolvedValue([]);
}

function renderAdmin(runData) {
  setupMocks(runData);
  return renderWithProviders(<PayrollDetail />, {
    route: '/payroll/run-1',
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer(runData) {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  setupMocks(runData);
  return renderWithProviders(<PayrollDetail />, {
    route: '/payroll/run-1',
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PayrollDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
  });

  it('smoke test -- renders without crashing', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText(/Payroll Run/)).toBeInTheDocument()
    );
  });

  it('shows loading state initially', () => {
    api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
    api.getPayrollRun.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<PayrollDetail />);
    expect(screen.getByText(/Loading payroll run/)).toBeInTheDocument();
  });

  it('shows not-found state when API fails to load run', async () => {
    api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
    api.getPayrollRun.mockRejectedValue(new Error('Network error'));
    renderWithProviders(<PayrollDetail />);
    // When getPayrollRun fails, run stays null, so the not-found state shows
    await waitFor(() =>
      expect(screen.getByText('Payroll run not found.')).toBeInTheDocument()
    );
  });

  it('renders staff lines table with correct column headers when calculated', async () => {
    renderAdmin(MOCK_CALCULATED_RUN);
    await waitFor(() =>
      expect(screen.getByText(/Payroll Run/)).toBeInTheDocument()
    );
    expect(screen.getByRole('columnheader', { name: 'Staff' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Hours' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Base Pay' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Night' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'GROSS' })).toBeInTheDocument();
  });

  it('renders summary cards for non-draft runs', async () => {
    renderAdmin(MOCK_CALCULATED_RUN);
    await waitFor(() =>
      expect(screen.getByText('Total Hours')).toBeInTheDocument()
    );
    // "Staff" appears in both the summary card and the table column header,
    // so verify at least 2 elements with that text (card + table header)
    expect(screen.getAllByText('Staff').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Total Gross')).toBeInTheDocument();
    expect(screen.getByText('Enhancements')).toBeInTheDocument();
  });

  it('shows Calculate button for admin on draft run', async () => {
    renderAdmin(MOCK_DRAFT_RUN);
    await waitFor(() =>
      expect(screen.getByText(/Payroll Run/)).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Calculate Now' })).toBeInTheDocument();
  });

  it('shows Recalculate and Approve buttons for admin on calculated run', async () => {
    renderAdmin(MOCK_CALCULATED_RUN);
    await waitFor(() =>
      expect(screen.getByText(/Payroll Run/)).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Recalculate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('hides action buttons for viewer role', async () => {
    renderViewer(MOCK_CALCULATED_RUN);
    await waitFor(() =>
      expect(screen.getByText(/Payroll Run/)).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Recalculate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('shows export buttons for admin on approved run', async () => {
    renderAdmin(MOCK_APPROVED_RUN);
    await waitFor(() =>
      expect(screen.getByText(/Payroll Run/)).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Sage CSV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xero CSV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generic CSV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Summary PDF' })).toBeInTheDocument();
  });
});
