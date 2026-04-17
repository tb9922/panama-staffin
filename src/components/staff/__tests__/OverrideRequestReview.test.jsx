import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders.jsx';
import OverrideRequestReview from '../OverrideRequestReview.jsx';

vi.mock('../../../lib/api.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'amberwood'),
    getPendingOverrideRequests: vi.fn(),
    decideOverrideRequest: vi.fn(),
  };
});

import { getPendingOverrideRequests, decideOverrideRequest } from '../../../lib/api.js';

describe('OverrideRequestReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPendingOverrideRequests.mockResolvedValue([
      {
        id: 11,
        date: '2026-04-22',
        requestType: 'AL',
        reason: 'Wedding',
        staffId: 'S009',
        version: 2,
      },
    ]);
    decideOverrideRequest.mockResolvedValue({ ok: true });
  });

  it('loads pending staff requests for manager review', async () => {
    renderWithProviders(<OverrideRequestReview />);

    expect(await screen.findByText('Pending leave requests')).toBeInTheDocument();
    expect(screen.getByText('2026-04-22')).toBeInTheDocument();
    expect(screen.getByText('Wedding')).toBeInTheDocument();
    expect(screen.getByText('Staff ID: S009')).toBeInTheDocument();
  });

  it('approves a request with the expected optimistic version and decision note', async () => {
    renderWithProviders(<OverrideRequestReview />);

    await screen.findByText('Wedding');
    // Expand the review pane first (note input is collapsed by default).
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.change(await screen.findByLabelText(/decision note/i), {
      target: { value: 'Approved, enjoy the wedding' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(decideOverrideRequest).toHaveBeenCalledWith('amberwood', 11, {
        status: 'approved',
        expectedVersion: 2,
        decisionNote: 'Approved, enjoy the wedding',
      });
    });
  });

  it('rejection requires a non-empty decision note', async () => {
    renderWithProviders(<OverrideRequestReview />);

    await screen.findByText('Wedding');
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const rejectBtn = await screen.findByRole('button', { name: 'Reject' });
    expect(rejectBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/decision note/i), {
      target: { value: 'Coverage gap — try a different week' },
    });
    expect(rejectBtn).not.toBeDisabled();

    fireEvent.click(rejectBtn);
    await waitFor(() => {
      expect(decideOverrideRequest).toHaveBeenCalledWith('amberwood', 11, {
        status: 'rejected',
        expectedVersion: 2,
        decisionNote: 'Coverage gap — try a different week',
      });
    });
  });

  it('approves with empty note (note required for rejection only)', async () => {
    renderWithProviders(<OverrideRequestReview />);

    await screen.findByText('Wedding');
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(decideOverrideRequest).toHaveBeenCalledWith('amberwood', 11, {
        status: 'approved',
        expectedVersion: 2,
        decisionNote: '',
      });
    });
  });
});
