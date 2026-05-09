import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders.jsx';
import MyDashboard from '../MyDashboard.jsx';

vi.mock('../ClockInButton.jsx', () => ({
  default: () => <div data-testid="clock-in-button">Clock in control</div>,
}));

vi.mock('../../../lib/api.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getMyDashboard: vi.fn(),
    downloadAuthenticatedFile: vi.fn(),
    getMyPayslipDownloadUrl: vi.fn(),
  };
});

import {
  getMyDashboard,
  downloadAuthenticatedFile,
  getMyPayslipDownloadUrl,
} from '../../../lib/api.js';

function dashboardPayload(overrides = {}) {
  return {
    schedule: {
      days: [
        { date: '2026-05-09', shift: 'E', scheduledShift: 'E' },
        { date: '2026-05-10', shift: 'AL', scheduledShift: 'L' },
      ],
    },
    accrual: { remainingHours: 64, accruedHours: 88 },
    training: { items: [{ id: 'fire', name: 'Fire', status: 'expired' }] },
    payslips: [{
      runId: 42,
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      netPay: 1234.56,
    }],
    requests: [{ id: 3, date: '2026-05-20', status: 'pending' }],
    ...overrides,
  };
}

describe('MyDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyDashboard.mockResolvedValue(dashboardPayload());
    getMyPayslipDownloadUrl.mockReturnValue('/api/payroll/runs/42/payslips/S001?home=test-home');
    downloadAuthenticatedFile.mockResolvedValue(undefined);
  });

  it('loads portal summary cards and safe navigation links', async () => {
    renderWithProviders(<MyDashboard />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    expect(await screen.findByText('Your staff portal')).toBeInTheDocument();
    expect(screen.getByTestId('clock-in-button')).toBeInTheDocument();
    expect(screen.getByText('64.0h')).toBeInTheDocument();
    expect(screen.getByText('Next: 2026-05-20')).toBeInTheDocument();
    expect(screen.getByText('Review your outstanding or expired training items.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage leave' })).toHaveAttribute('href', '/leave');
    expect(screen.getByRole('link', { name: 'View full rota' })).toHaveAttribute('href', '/schedule');
    expect(screen.getByRole('link', { name: 'Review training' })).toHaveAttribute('href', '/training');
  });

  it('downloads a payslip with the linked staff id', async () => {
    renderWithProviders(<MyDashboard />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    await screen.findByText('2026-04-01 to 2026-04-30');
    fireEvent.click(screen.getByRole('button', { name: /PDF/i }));

    await waitFor(() => {
      expect(getMyPayslipDownloadUrl).toHaveBeenCalledWith(42, 'S001');
    });
    expect(downloadAuthenticatedFile).toHaveBeenCalledWith(
      '/api/payroll/runs/42/payslips/S001?home=test-home',
      'payslip_2026-04-01.pdf',
    );
  });

  it('shows a download error instead of throwing invisibly', async () => {
    downloadAuthenticatedFile.mockRejectedValueOnce(new Error('Download failed (403)'));

    renderWithProviders(<MyDashboard />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    await screen.findByText('2026-04-01 to 2026-04-30');
    fireEvent.click(screen.getByRole('button', { name: /PDF/i }));

    expect(await screen.findByText('Unable to download payslip')).toBeInTheDocument();
    expect(screen.getByText('Download failed (403)')).toBeInTheDocument();
  });

  it('offers retry after the dashboard load fails', async () => {
    getMyDashboard.mockRejectedValueOnce(new Error('Session expired')).mockResolvedValueOnce(dashboardPayload({ payslips: [] }));

    renderWithProviders(<MyDashboard />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    expect(await screen.findByText('Unable to load your portal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(getMyDashboard).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('Your staff portal')).toBeInTheDocument();
  });
});
