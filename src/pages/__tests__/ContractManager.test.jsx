import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import ContractManager from '../ContractManager.jsx';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHrContracts: vi.fn(),
    createHrContract: vi.fn(),
    updateHrContract: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const MOCK_CONTRACT = {
  id: 'CON-001',
  staff_id: 'S005',
  contract_type: 'permanent',
  start_date: '2025-06-01',
  end_date: '',
  status: 'active',
  hours_per_week: 37.5,
  probation_end_date: '2025-12-01',
  version: 1,
};

const MOCK_PROBATION_CONTRACT = {
  id: 'CON-002',
  staff_id: 'S006',
  contract_type: 'fixed_term',
  start_date: '2026-01-15',
  end_date: '2026-07-15',
  status: 'probation',
  hours_per_week: 24,
  probation_end_date: '2026-07-15',
  version: 1,
};

const MOCK_RESPONSE = { rows: [MOCK_CONTRACT], total: 1 };
const EMPTY_RESPONSE = { rows: [], total: 0 };

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  api.getCurrentHome.mockReturnValue('test-home');
  api.getHrContracts.mockResolvedValue(MOCK_RESPONSE);
  api.getHrStaffList.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ContractManager', () => {
  it('smoke test — renders without crashing', async () => {
    renderWithProviders(<ContractManager />);
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading contracts/i) ||
        screen.queryByText(/Contract Manager/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getHrContracts.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ContractManager />);
    expect(screen.getByText('Loading contracts...')).toBeInTheDocument();
  });

  it('shows error banner when API call fails', async () => {
    api.getHrContracts.mockRejectedValue(new Error('DB connection failed'));
    renderWithProviders(<ContractManager />);
    await waitFor(() => {
      expect(screen.getByText('DB connection failed')).toBeInTheDocument();
    });
  });

  it('displays page heading and subtitle after load', async () => {
    renderWithProviders(<ContractManager />);
    await waitFor(() => {
      expect(screen.getByText('Contract Manager')).toBeInTheDocument();
    });
    expect(screen.getByText('Staff contracts, probation tracking, and employment terms')).toBeInTheDocument();
  });

  it('displays contract row with staff ID and start date', async () => {
    renderWithProviders(<ContractManager />);
    await waitFor(() => {
      expect(screen.getByText('S005')).toBeInTheDocument();
    });
    expect(screen.getByText('2025-06-01')).toBeInTheDocument();
  });

  it('shows empty state when no contracts exist', async () => {
    api.getHrContracts.mockResolvedValue(EMPTY_RESPONSE);
    renderWithProviders(<ContractManager />);
    await waitFor(() => {
      expect(screen.getByText('No contracts')).toBeInTheDocument();
    });
  });

  it('shows New Contract button', async () => {
    renderWithProviders(<ContractManager />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Contract/i })).toBeInTheDocument();
    });
  });

  it('shows filter dropdowns for status and type', async () => {
    renderWithProviders(<ContractManager />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('All Statuses')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('All Types')).toBeInTheDocument();
  });

  it('shows probation tracker section when probation contracts exist', async () => {
    api.getHrContracts.mockResolvedValue({ rows: [MOCK_PROBATION_CONTRACT], total: 1 });
    renderWithProviders(<ContractManager />);
    await waitFor(() => {
      expect(screen.getByText('Probation Tracker')).toBeInTheDocument();
    });
    expect(screen.getAllByText('S006').length).toBeGreaterThanOrEqual(1);
  });
});
