import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import EdiTracker from '../EdiTracker.jsx';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHrEdi: vi.fn(),
    createHrEdi: vi.fn(),
    updateHrEdi: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const MOCK_HARASSMENT = {
  id: 'EDI-001',
  record_type: 'harassment_complaint',
  staff_id: 'S030',
  date_recorded: '2026-02-10',
  category: 'race',
  status: 'open',
  third_party: false,
  respondent_name: 'John Doe',
  respondent_role: 'Senior Carer',
  version: 1,
};

const MOCK_ADJUSTMENT = {
  id: 'EDI-002',
  record_type: 'reasonable_adjustment',
  staff_id: 'S031',
  date_recorded: '2026-01-15',
  category: 'Physical',
  status: 'resolved',
  condition_description: 'Back injury requiring adapted workstation',
  adjustments: 'Height-adjustable desk, ergonomic chair',
  version: 1,
};

const MOCK_RESPONSE = { rows: [MOCK_HARASSMENT], total: 1 };
const EMPTY_RESPONSE = { rows: [], total: 0 };

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  api.getCurrentHome.mockReturnValue('test-home');
  api.getHrEdi.mockResolvedValue(MOCK_RESPONSE);
  api.getHrStaffList.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('EdiTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderWithProviders(<EdiTracker />);
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading EDI/i) ||
        screen.queryByText(/Equality, Diversity & Inclusion/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getHrEdi.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<EdiTracker />);
    expect(screen.getByText('Loading EDI data...')).toBeInTheDocument();
  });

  it('shows error banner when API call fails', async () => {
    api.getHrEdi.mockRejectedValue(new Error('Forbidden'));
    renderWithProviders(<EdiTracker />);
    await waitFor(() => {
      expect(screen.getByText('Forbidden')).toBeInTheDocument();
    });
  });

  it('displays page heading and Equality Act subtitle after load', async () => {
    renderWithProviders(<EdiTracker />);
    await waitFor(() => {
      expect(screen.getByText('Equality, Diversity & Inclusion')).toBeInTheDocument();
    });
    expect(screen.getByText(/Equality Act 2010/)).toBeInTheDocument();
  });

  it('displays harassment record row with staff ID and date', async () => {
    renderWithProviders(<EdiTracker />);
    await waitFor(() => {
      expect(screen.getByText('S030')).toBeInTheDocument();
    });
    expect(screen.getByText('2026-02-10')).toBeInTheDocument();
  });

  it('shows record type name in table', async () => {
    renderWithProviders(<EdiTracker />);
    await waitFor(() => {
      expect(screen.getAllByText('Harassment Complaint').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows reasonable adjustment record type', async () => {
    api.getHrEdi.mockResolvedValue({ rows: [MOCK_ADJUSTMENT], total: 1 });
    renderWithProviders(<EdiTracker />);
    await waitFor(() => {
      expect(screen.getAllByText('Reasonable Adjustment').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows empty state when no records exist', async () => {
    api.getHrEdi.mockResolvedValue(EMPTY_RESPONSE);
    renderWithProviders(<EdiTracker />);
    await waitFor(() => {
      expect(screen.getByText('No EDI records')).toBeInTheDocument();
    });
  });

  it('shows New Record button', async () => {
    renderWithProviders(<EdiTracker />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Record/i })).toBeInTheDocument();
    });
  });
});
