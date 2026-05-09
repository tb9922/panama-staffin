import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders.jsx';
import MyPayslips from '../MyPayslips.jsx';

vi.mock('../../../lib/api.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getMyPayslips: vi.fn(),
    downloadAuthenticatedFile: vi.fn(),
    getMyPayslipDownloadUrl: vi.fn(),
  };
});

import {
  getMyPayslips,
  downloadAuthenticatedFile,
  getMyPayslipDownloadUrl,
} from '../../../lib/api.js';

const PAYSLIP_ROWS = [{
  runId: 42,
  periodStart: '2026-04-01',
  periodEnd: '2026-04-30',
  status: 'approved',
  grossPay: 1500,
  netPay: 1234.56,
}];

describe('MyPayslips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyPayslips.mockResolvedValue(PAYSLIP_ROWS);
    getMyPayslipDownloadUrl.mockReturnValue('/api/payroll/runs/42/payslips/S001?home=test-home');
    downloadAuthenticatedFile.mockResolvedValue(undefined);
  });

  it('loads payslip rows with labelled download controls', async () => {
    renderWithProviders(<MyPayslips />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    expect(await screen.findByText('My Payslips')).toBeInTheDocument();
    expect(screen.getByText('2026-04-01 to 2026-04-30')).toBeInTheDocument();
    expect(screen.getByText('GBP 1,500.00 gross')).toBeInTheDocument();
    expect(screen.getByText('GBP 1,234.56 net')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download payslip 2026-04-01 to 2026-04-30' })).toBeInTheDocument();
  });

  it('shows an empty state when there are no payslips', async () => {
    getMyPayslips.mockResolvedValueOnce([]);

    renderWithProviders(<MyPayslips />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    expect(await screen.findByText('No payslips yet')).toBeInTheDocument();
  });

  it('offers retry after the initial payslip load fails', async () => {
    getMyPayslips.mockRejectedValueOnce(new Error('Session expired')).mockResolvedValueOnce([]);

    renderWithProviders(<MyPayslips />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    expect(await screen.findByText('Unable to load payslips')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(getMyPayslips).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('No payslips yet')).toBeInTheDocument();
  });

  it('downloads the selected payslip for the linked staff id', async () => {
    renderWithProviders(<MyPayslips />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    await screen.findByText('2026-04-01 to 2026-04-30');
    fireEvent.click(screen.getByRole('button', { name: 'Download payslip 2026-04-01 to 2026-04-30' }));

    await waitFor(() => {
      expect(getMyPayslipDownloadUrl).toHaveBeenCalledWith(42, 'S001');
    });
    expect(downloadAuthenticatedFile).toHaveBeenCalledWith(
      '/api/payroll/runs/42/payslips/S001?home=test-home',
      'payslip_2026-04-01.pdf',
    );
  });

  it('shows a download error when the PDF request fails', async () => {
    downloadAuthenticatedFile.mockRejectedValueOnce(new Error('Download failed (403)'));

    renderWithProviders(<MyPayslips />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    await screen.findByText('2026-04-01 to 2026-04-30');
    fireEvent.click(screen.getByRole('button', { name: 'Download payslip 2026-04-01 to 2026-04-30' }));

    expect(await screen.findByText('Unable to download payslip')).toBeInTheDocument();
    expect(screen.getByText('Download failed (403)')).toBeInTheDocument();
  });
});
