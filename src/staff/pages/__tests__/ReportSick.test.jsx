import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders.jsx';
import { addDaysLocalISO, todayLocalISO } from '../../../lib/localDates.js';
import ReportSick from '../ReportSick.jsx';

vi.mock('../../../lib/api.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    reportMySick: vi.fn(),
  };
});

import { reportMySick } from '../../../lib/api.js';

describe('ReportSick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportMySick.mockResolvedValue({ ok: true });
  });

  it('submits today or tomorrow, trims the note, and resets after success', async () => {
    const today = todayLocalISO();
    const tomorrow = addDaysLocalISO(today, 1);

    renderWithProviders(<ReportSick />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    const dateInput = screen.getByLabelText('Date');
    const reasonInput = screen.getByLabelText('Reason');
    expect(dateInput).toHaveAttribute('min', today);
    expect(dateInput).toHaveAttribute('max', tomorrow);

    fireEvent.change(dateInput, { target: { value: tomorrow } });
    fireEvent.change(reasonInput, { target: { value: '  Flu symptoms  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit sick report' }));

    await waitFor(() => {
      expect(reportMySick).toHaveBeenCalledWith({ date: tomorrow, reason: 'Flu symptoms' });
    });
    expect(await screen.findByText('Your sick report has been logged and your manager can review it straight away.')).toBeInTheDocument();
    expect(dateInput).toHaveValue(today);
    expect(reasonInput).toHaveValue('');
  });

  it('shows a clear error when the report fails', async () => {
    reportMySick.mockRejectedValueOnce(new Error('Self-reported sickness can only be recorded for today or tomorrow'));

    renderWithProviders(<ReportSick />, {
      staffId: 'S001',
      user: { username: 'staff', role: 'staff_member', displayName: 'Staff User' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit sick report' }));

    expect(await screen.findByText('Unable to report sick')).toBeInTheDocument();
    expect(screen.getByText('Self-reported sickness can only be recorded for today or tomorrow')).toBeInTheDocument();
  });
});
