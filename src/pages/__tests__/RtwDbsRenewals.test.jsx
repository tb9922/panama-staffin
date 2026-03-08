import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import RtwDbsRenewals from '../RtwDbsRenewals.jsx';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHrRenewals: vi.fn(),
    createHrRenewal: vi.fn(),
    updateHrRenewal: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const MOCK_DBS_CHECK = {
  id: 'REN-001',
  staff_id: 'S040',
  check_type: 'dbs',
  last_checked: '2025-06-15',
  expiry_date: '2028-06-15',
  status: 'current',
  reference: 'DBS-12345',
  checked_by: 'HR Manager',
  certificate_number: 'CERT-99999',
  version: 1,
};

const MOCK_EXPIRED_RTW = {
  id: 'REN-002',
  staff_id: 'S041',
  check_type: 'rtw',
  last_checked: '2024-01-10',
  expiry_date: '2025-01-10',
  status: 'expired',
  reference: 'RTW-54321',
  checked_by: 'Admin',
  document_type: 'BRP',
  version: 1,
};

const MOCK_RESPONSE = { rows: [MOCK_DBS_CHECK], total: 1 };
const EMPTY_RESPONSE = { rows: [], total: 0 };

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  api.getHrRenewals.mockResolvedValue(MOCK_RESPONSE);
  api.getHrStaffList.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RtwDbsRenewals', () => {
  it('smoke test — renders without crashing', async () => {
    renderWithProviders(<RtwDbsRenewals />);
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading renewal/i) ||
        screen.queryByText(/RTW & DBS Renewals/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getHrRenewals.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<RtwDbsRenewals />);
    expect(screen.getByText('Loading renewal data...')).toBeInTheDocument();
  });

  it('shows error banner when API call fails', async () => {
    api.getHrRenewals.mockRejectedValue(new Error('Unauthorized'));
    renderWithProviders(<RtwDbsRenewals />);
    await waitFor(() => {
      expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    });
  });

  it('displays page heading and CQC Reg 19 reference after load', async () => {
    renderWithProviders(<RtwDbsRenewals />);
    await waitFor(() => {
      expect(screen.getByText('RTW & DBS Renewals')).toBeInTheDocument();
    });
    expect(screen.getByText(/CQC Reg 19/)).toBeInTheDocument();
  });

  it('displays check row with staff ID and check type', async () => {
    renderWithProviders(<RtwDbsRenewals />);
    await waitFor(() => {
      expect(screen.getByText('S040')).toBeInTheDocument();
    });
    expect(screen.getByText('2025-06-15')).toBeInTheDocument();
  });

  it('shows overdue/expired count in subtitle when present', async () => {
    api.getHrRenewals.mockResolvedValue({ rows: [MOCK_EXPIRED_RTW], total: 1 });
    renderWithProviders(<RtwDbsRenewals />);
    await waitFor(() => {
      expect(screen.getByText(/1 overdue\/expired/)).toBeInTheDocument();
    });
  });

  it('shows empty state when no records exist', async () => {
    api.getHrRenewals.mockResolvedValue(EMPTY_RESPONSE);
    renderWithProviders(<RtwDbsRenewals />);
    await waitFor(() => {
      expect(screen.getByText('No renewal records')).toBeInTheDocument();
    });
  });

  it('shows New Check button', async () => {
    renderWithProviders(<RtwDbsRenewals />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Check/i })).toBeInTheDocument();
    });
  });

  it('shows filter dropdowns for check type and status', async () => {
    renderWithProviders(<RtwDbsRenewals />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('All Check Types')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('All Statuses')).toBeInTheDocument();
  });
});
