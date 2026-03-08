import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import TaxCodeManager from '../TaxCodeManager.jsx';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getSchedulingData: vi.fn(),
    getTaxCodes: vi.fn(),
    upsertTaxCode: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([]),
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
    { id: 'S001', name: 'Alice Smith', role: 'Senior Carer', active: true, contract_hours: 36, ni_number: 'AB123456C' },
    { id: 'S002', name: 'Bob Jones', role: 'Carer', active: true, contract_hours: 36, ni_number: null },
    { id: 'S003', name: 'Carol Davis', role: 'Night Carer', active: true, contract_hours: 30, ni_number: null },
  ],
  overrides: {},
  config: {
    cycle_start_date: '2025-01-06',
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
    bank_holidays: [],
  },
};

const MOCK_TAX_CODES = [
  {
    id: 'tc-1',
    staff_id: 'S001',
    tax_code: '1257L',
    basis: 'cumulative',
    ni_category: 'A',
    effective_from: '2025-04-06',
    previous_pay: 15000,
    previous_tax: 2500,
    student_loan_plan: '2',
    source: 'p45',
    notes: 'From previous employer',
  },
  {
    id: 'tc-2',
    staff_id: 'S002',
    tax_code: 'S1257L',
    basis: 'w1m1',
    ni_category: 'A',
    effective_from: '2026-01-15',
    previous_pay: 0,
    previous_tax: 0,
    student_loan_plan: '',
    source: 'starter',
    notes: '',
  },
];

function setupMocks(codes = MOCK_TAX_CODES) {
  api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
  api.getTaxCodes.mockResolvedValue(codes);
  api.upsertTaxCode.mockResolvedValue({});
}

function renderAdmin(codes) {
  setupMocks(codes);
  return renderWithProviders(<TaxCodeManager />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer(codes) {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  setupMocks(codes);
  return renderWithProviders(<TaxCodeManager />, {
    user: { username: 'viewer', role: 'viewer' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaxCodeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
  });

  it('smoke test -- renders without crashing', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Tax Code Manager')).toBeInTheDocument()
    );
  });

  it('shows loading state initially', () => {
    api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
    api.getTaxCodes.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<TaxCodeManager />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error message when API fails', async () => {
    api.getSchedulingData.mockResolvedValue(MOCK_SCHED_DATA);
    api.getTaxCodes.mockRejectedValue(new Error('Database timeout'));
    renderWithProviders(<TaxCodeManager />);
    await waitFor(() =>
      expect(screen.getByText('Database timeout')).toBeInTheDocument()
    );
  });

  it('renders tax code table with correct column headers', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: 'Staff Member' })).toBeInTheDocument()
    );
    expect(screen.getByRole('columnheader', { name: 'Tax Code' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Basis' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'NI Cat.' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Student Loan' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Source' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
  });

  it('renders tax code data in table rows', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('1257L')).toBeInTheDocument()
    );
    expect(screen.getByText('S1257L')).toBeInTheDocument();
    // W1/M1 emergency badge should appear for S002
    expect(screen.getByText('W1/M1')).toBeInTheDocument();
    // Source labels
    expect(screen.getByText('P45')).toBeInTheDocument();
    expect(screen.getByText('Starter Checklist')).toBeInTheDocument();
  });

  it('shows Add / Update Tax Code button for admin', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Tax Code Manager')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Add / Update Tax Code' })).toBeInTheDocument();
  });

  it('hides Add / Update Tax Code button and Actions column for viewer', async () => {
    renderViewer();
    await waitFor(() =>
      expect(screen.getByText('Tax Code Manager')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Add / Update Tax Code' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('shows missing tax code alert when staff have no record', async () => {
    renderAdmin();
    // Wait for scheduling data to load (which populates activeStaff / missingCodes list)
    // S003 has no tax code record — the alert depends on schedData being loaded
    await waitFor(() =>
      expect(screen.getByText(/No tax code on file for/)).toBeInTheDocument()
    );
    expect(screen.getAllByText(/Carol Davis/).length).toBeGreaterThanOrEqual(1);
  });

  it('opens modal when admin clicks Add / Update Tax Code', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add / Update Tax Code' })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: 'Add / Update Tax Code' }));
    // Modal dialog should appear with the form title
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Add Tax Code')).toBeInTheDocument();
    // "Tax Code", "Basis", "NI Category" appear in both table headers and modal labels,
    // so use getAllByText to verify they're present (table header + modal label = 2 each)
    expect(screen.getAllByText('Tax Code').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Basis').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('NI Category')).toBeInTheDocument();
  });
});
