import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import ClockInAudit from '../ClockInAudit.jsx';

vi.mock('../../lib/api.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'amberwood'),
    getClockInUnapproved: vi.fn(),
    getClockInsByDate: vi.fn(),
    approveClockIn: vi.fn(),
    createManualClockIn: vi.fn(),
  };
});

import {
  approveClockIn,
  createManualClockIn,
  getClockInUnapproved,
  getClockInsByDate,
  getCurrentHome,
} from '../../lib/api.js';

describe('ClockInAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentHome.mockReturnValue('amberwood');
    getClockInUnapproved.mockResolvedValue([
      {
        id: 71,
        staffId: 'S001',
        staffName: 'Alice Carer',
        clockType: 'in',
        serverTime: '2026-05-08T07:30:00Z',
        withinGeofence: false,
        distanceM: 234,
        accuracyM: 20,
      },
    ]);
    getClockInsByDate.mockResolvedValue([
      {
        id: 72,
        staffId: 'S002',
        staffName: 'Bob Carer',
        clockType: 'out',
        serverTime: '2026-05-08T16:30:00Z',
        withinGeofence: true,
        approved: true,
      },
    ]);
    approveClockIn.mockResolvedValue({ ok: true });
    createManualClockIn.mockResolvedValue({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows staff names and confirms before approving exceptions', async () => {
    renderWithProviders(<ClockInAudit />, { canWrite: true });

    expect(await screen.findByText('Alice Carer (S001)')).toBeInTheDocument();
    expect(screen.getByText('Bob Carer (S002)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }));

    expect(window.confirm).toHaveBeenCalledWith('Approve clock-in for Alice Carer (S001)?');
    expect(approveClockIn).not.toHaveBeenCalled();

    window.confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }));
    await waitFor(() => {
      expect(approveClockIn).toHaveBeenCalledWith('amberwood', 71);
    });
  });

  it('does not load or expose manual actions when the staff portal is disabled', async () => {
    renderWithProviders(<ClockInAudit />, { canWrite: true, staffPortalEnabled: false });

    expect(await screen.findByText(/Staff portal is disabled/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add manual entry/i })).not.toBeInTheDocument();
    expect(getClockInUnapproved).not.toHaveBeenCalled();
    expect(getClockInsByDate).not.toHaveBeenCalled();
  });

  it('submits a manual entry through the labelled controls', async () => {
    renderWithProviders(<ClockInAudit />, { canWrite: true });

    await screen.findByText('Manual clock-in');
    fireEvent.change(screen.getByLabelText('Staff ID'), { target: { value: ' S003 ' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'out' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: ' Manager correction ' } });
    fireEvent.click(screen.getByRole('button', { name: /Add manual entry/i }));

    await waitFor(() => {
      expect(createManualClockIn).toHaveBeenCalledWith('amberwood', expect.objectContaining({
        staffId: 'S003',
        clockType: 'out',
        note: 'Manager correction',
      }));
    });
  });

  it('keeps whitespace-only manual submissions on the form', async () => {
    renderWithProviders(<ClockInAudit />, { canWrite: true });

    await screen.findByText('Manual clock-in');
    fireEvent.change(screen.getByLabelText('Staff ID'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /Add manual entry/i }));

    expect(await screen.findByText('Staff ID is required.')).toBeInTheDocument();
    expect(createManualClockIn).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Staff ID'), { target: { value: 'S004' } });
    expect(screen.queryByText('Staff ID is required.')).not.toBeInTheDocument();
  });

  it('shows manual create failures beside the manual form', async () => {
    createManualClockIn.mockRejectedValueOnce(new Error('Staff member not found'));
    renderWithProviders(<ClockInAudit />, { canWrite: true });

    await screen.findByText('Manual clock-in');
    fireEvent.change(screen.getByLabelText('Staff ID'), { target: { value: 'S999' } });
    fireEvent.click(screen.getByRole('button', { name: /Add manual entry/i }));

    expect(await screen.findByText('Staff member not found')).toBeInTheDocument();
    expect(screen.queryByText('Clock-in audit error')).not.toBeInTheDocument();
  });

  it('does not request the daily list with an empty date', async () => {
    renderWithProviders(<ClockInAudit />, { canWrite: true });

    const dateInput = await screen.findByLabelText('Clock-ins date');
    fireEvent.change(dateInput, { target: { value: '' } });

    await waitFor(() => {
      expect(getClockInsByDate.mock.calls.some(([, value]) => value === '')).toBe(false);
    });
  });
});
