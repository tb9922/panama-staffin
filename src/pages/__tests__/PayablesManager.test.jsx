import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import PayablesManager from '../PayablesManager.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getPaymentSchedules: vi.fn(),
    createPaymentSchedule: vi.fn(),
    updatePaymentSchedule: vi.fn(),
    processPaymentSchedule: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

const today = new Date().toISOString().slice(0, 10);
const in3Days = (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().slice(0, 10); })();

const MOCK_SCHEDULES = {
  rows: [
    {
      id: 1, supplier: 'ABC Cleaning', category: 'other', description: 'Monthly deep clean',
      frequency: 'monthly', amount: 1500, next_due: in3Days,
      auto_approve: false, on_hold: false, version: 1,
    },
    {
      id: 2, supplier: 'XYZ Utilities', category: 'other', description: 'Gas bill',
      frequency: 'quarterly', amount: 2800, next_due: '2026-06-01',
      auto_approve: true, on_hold: true, hold_reason: 'Disputed', version: 1,
    },
  ],
  total: 2,
};

function setupMocks(data = MOCK_SCHEDULES) {
  api.getPaymentSchedules.mockResolvedValue(data);
}

function renderAdmin(data) {
  setupMocks(data);
  return renderWithProviders(<PayablesManager />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer(data) {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  setupMocks(data);
  return renderWithProviders(<PayablesManager />, {
    user: { username: 'viewer', role: 'viewer' },
  });
}

describe('PayablesManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
  });

  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Payables')).toBeInTheDocument()
    );
  });

  it('shows loading text initially', () => {
    api.getPaymentSchedules.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<PayablesManager />);
    expect(screen.getByText('Loading payment schedules...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getPaymentSchedules.mockRejectedValue(new Error('Server error'));
    renderWithProviders(<PayablesManager />);
    await waitFor(() =>
      expect(screen.getByText('Server error')).toBeInTheDocument()
    );
  });

  it('renders KPI cards after load', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('Active Schedules')).toBeInTheDocument()
    );
    expect(screen.getByText('Due This Week')).toBeInTheDocument();
    // 'On Hold' appears in KPI card label and table status badge
    expect(screen.getAllByText('On Hold').length).toBeGreaterThanOrEqual(1);
  });

  it('renders schedule table with supplier names', async () => {
    renderAdmin();
    // ABC Cleaning appears in both Payments Due and All Schedules sections
    await waitFor(() =>
      expect(screen.getAllByText('ABC Cleaning').length).toBeGreaterThanOrEqual(1)
    );
    expect(screen.getByText('XYZ Utilities')).toBeInTheDocument();
  });

  it('shows Add Schedule button for admin', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Schedule' })).toBeInTheDocument()
    );
  });

  it('hides Add Schedule button for viewer', async () => {
    renderViewer();
    await waitFor(() =>
      expect(screen.getAllByText('ABC Cleaning').length).toBeGreaterThanOrEqual(1)
    );
    expect(screen.queryByRole('button', { name: 'Add Schedule' })).not.toBeInTheDocument();
  });

  it('opens Add Payment Schedule modal on button click', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Schedule' })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: 'Add Schedule' }));
    expect(screen.getByText('Add Payment Schedule')).toBeInTheDocument();
    expect(screen.getByText('Supplier *')).toBeInTheDocument();
  });
});
