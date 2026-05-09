import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { useData } from '../../contexts/DataContext.jsx';
import OperationalReviews from '../OperationalReviews.jsx';

vi.mock('../../lib/operationalReviewApi.js', () => ({
  getOperationalReviews: vi.fn(),
}));

import { getOperationalReviews } from '../../lib/operationalReviewApi.js';

const PAYLOAD = {
  generated_at: '2026-05-04T09:30:00Z',
  summary: {
    total: 2,
    by_type: {
      overdue_escalation: 1,
      emergency_agency_override: 0,
      unverified_completed_action: 1,
      evidence_missing: 0,
      manager_sign_off_required: 0,
    },
    by_severity: { critical: 0, high: 1, medium: 1, low: 0 },
  },
  items: [
    {
      id: 'overdue_escalation:action_item:1:11',
      type: 'overdue_escalation',
      type_label: 'Overdue escalation',
      severity: 'high',
      home: { id: 1, slug: 'amberwood', name: 'Amberwood' },
      title: 'Safeguarding action overdue',
      owner_label: 'Dana Manager',
      actionable_label: 'Escalation L3',
      display_date: '2026-04-28',
      link_target: {
        path: '/actions',
        module: 'governance',
        home_slug: 'amberwood',
        source_kind: 'action_item',
        source_id: '11',
      },
    },
    {
      id: 'unverified_completed_action:action_item:1:12',
      type: 'unverified_completed_action',
      type_label: 'Unverified completed action',
      severity: 'medium',
      home: { id: 1, slug: 'amberwood', name: 'Amberwood' },
      title: 'Completed action awaiting check',
      owner_label: 'Deputy Manager',
      actionable_label: 'Verification required',
      display_date: '2026-05-02',
      link_target: {
        path: '/actions',
        module: 'governance',
        home_slug: 'amberwood',
        source_kind: 'action_item',
        source_id: '12',
      },
    },
  ],
};

describe('OperationalReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOperationalReviews.mockResolvedValue(PAYLOAD);
  });

  it('renders review queues and opens source metadata without mutations', async () => {
    const switchHome = vi.fn();
    useData.mockReturnValue({
      canRead: () => true,
      canWrite: () => false,
      homeRole: 'home_manager',
      staffId: null,
      switchHome,
    });

    renderWithProviders(<OperationalReviews />, {
      route: '/operational-reviews',
      user: { username: 'manager', role: 'admin' },
    });

    await waitFor(() => expect(screen.getByText('Operational Reviews')).toBeInTheDocument());
    expect(screen.getByText('Safeguarding action overdue')).toBeInTheDocument();
    expect(screen.getByText('Dana Manager')).toBeInTheDocument();
    expect(screen.getAllByText('High').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /new/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    expect(switchHome).toHaveBeenCalledWith('amberwood');
  });

  it('does not show placeholder summary tiles while loading', () => {
    getOperationalReviews.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<OperationalReviews />, {
      route: '/operational-reviews',
      user: { username: 'manager', role: 'admin' },
    });

    expect(screen.getByText('Loading operational reviews...')).toBeInTheDocument();
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });

  it('falls back cleanly for malformed review dates', async () => {
    getOperationalReviews.mockResolvedValue({
      ...PAYLOAD,
      items: [{ ...PAYLOAD.items[0], display_date: 'not-a-date' }],
    });
    renderWithProviders(<OperationalReviews />, {
      route: '/operational-reviews',
      user: { username: 'manager', role: 'admin' },
    });

    await waitFor(() => expect(screen.getByText('Safeguarding action overdue')).toBeInTheDocument());
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument();
  });

  it('passes filter changes to the API helper', async () => {
    renderWithProviders(<OperationalReviews />, {
      route: '/operational-reviews',
      user: { username: 'manager', role: 'admin' },
    });

    await waitFor(() => expect(getOperationalReviews).toHaveBeenCalledWith(
      { type: '', severity: '', limit: 250 },
      expect.any(Object),
    ));

    await userEvent.selectOptions(screen.getByLabelText('Filter by severity'), 'high');

    await waitFor(() => expect(getOperationalReviews).toHaveBeenLastCalledWith(
      { type: '', severity: 'high', limit: 250 },
      expect.any(Object),
    ));
  });
});
