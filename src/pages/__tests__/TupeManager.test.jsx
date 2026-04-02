import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import TupeManager from '../TupeManager.jsx';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHrTupe: vi.fn(),
    createHrTupe: vi.fn(),
    updateHrTupe: vi.fn(),
    getHrStaffList: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const MOCK_TRANSFER = {
  id: 'TUPE-001',
  transfer_type: 'incoming',
  transfer_date: '2026-06-01',
  transferor_name: 'OldCo Care Services',
  transferee_name: 'NewCo Care Group',
  status: 'planned',
  staff_affected: 12,
  consultation_start: '2026-04-01',
  consultation_end: '2026-05-31',
  eli_sent_date: '2026-03-15',
  version: 1,
};

const MOCK_OUTGOING = {
  id: 'TUPE-002',
  transfer_type: 'outgoing',
  transfer_date: '2026-09-01',
  transferor_name: 'Our Care Home',
  transferee_name: 'Acquiring Ltd',
  status: 'consultation',
  staff_affected: 5,
  version: 1,
};

const MOCK_RESPONSE = { rows: [MOCK_TRANSFER], total: 1 };
const EMPTY_RESPONSE = { rows: [], total: 0 };

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  api.getHrTupe.mockResolvedValue(MOCK_RESPONSE);
  api.getHrStaffList.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('TupeManager', () => {
  it('smoke test — renders without crashing', async () => {
    renderWithProviders(<TupeManager />);
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading TUPE/i) ||
        screen.queryByText(/TUPE Transfers/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getHrTupe.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<TupeManager />);
    expect(screen.getByText('Loading TUPE transfers...')).toBeInTheDocument();
  });

  it('shows error banner when API call fails', async () => {
    api.getHrTupe.mockRejectedValue(new Error('Internal server error'));
    renderWithProviders(<TupeManager />);
    await waitFor(() => {
      expect(screen.getByText('Internal server error')).toBeInTheDocument();
    });
  });

  it('displays page heading and subtitle after load', async () => {
    renderWithProviders(<TupeManager />);
    await waitFor(() => {
      expect(screen.getByText('TUPE Transfers')).toBeInTheDocument();
    });
    expect(screen.getByText(/Transfer of Undertakings/)).toBeInTheDocument();
  });

  it('displays transfer row with transferor and transferee names', async () => {
    renderWithProviders(<TupeManager />);
    await waitFor(() => {
      expect(screen.getByText('OldCo Care Services')).toBeInTheDocument();
    });
    expect(screen.getByText('NewCo Care Group')).toBeInTheDocument();
    expect(screen.getByText('2026-06-01')).toBeInTheDocument();
  });

  it('shows Incoming badge for incoming transfer type', async () => {
    renderWithProviders(<TupeManager />);
    await waitFor(() => {
      expect(screen.getByText('Incoming')).toBeInTheDocument();
    });
  });

  it('shows Outgoing badge for outgoing transfer type', async () => {
    api.getHrTupe.mockResolvedValue({ rows: [MOCK_OUTGOING], total: 1 });
    renderWithProviders(<TupeManager />);
    await waitFor(() => {
      expect(screen.getByText('Outgoing')).toBeInTheDocument();
    });
  });

  it('shows empty state when no transfers exist', async () => {
    api.getHrTupe.mockResolvedValue(EMPTY_RESPONSE);
    renderWithProviders(<TupeManager />);
    await waitFor(() => {
      expect(screen.getByText('No TUPE transfers')).toBeInTheDocument();
    });
  });

  it('shows New Transfer button', async () => {
    renderWithProviders(<TupeManager />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Transfer/i })).toBeInTheDocument();
    });
  });

  it('requires transferee name before saving', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TupeManager />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Transfer/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /New Transfer/i }));
    await user.type(screen.getByLabelText('Transfer Date'), '2026-06-01');
    await user.type(screen.getByLabelText('Transferor Name'), 'OldCo Care Services');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('Transferee name is required')).toBeInTheDocument();
    expect(api.createHrTupe).not.toHaveBeenCalled();
  });

  it('shows the expanded consultation and due diligence fields in the modal', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TupeManager />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Transfer/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /New Transfer/i }));
    expect(screen.getByLabelText('Signed Date')).toBeInTheDocument();
    expect(screen.getByLabelText('Measures Letter Date')).toBeInTheDocument();
    expect(screen.getByLabelText('ELI Complete')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Employee Representatives Consulted'));
    expect(screen.getByLabelText('Representative Names')).toBeInTheDocument();

    expect(screen.getByLabelText('Due Diligence Notes')).toBeInTheDocument();
    expect(screen.getByLabelText('Outstanding Claims')).toBeInTheDocument();
    expect(screen.getByLabelText('Outstanding Tribunal Claims')).toBeInTheDocument();
  });
});
