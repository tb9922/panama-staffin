import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import AccessReviews from '../AccessReviews.jsx';

vi.mock('../../lib/accessReviewApi.js', () => ({
  listAccessReviews: vi.fn(),
  startAccessReview: vi.fn(),
  getAccessReview: vi.fn(),
  updateAccessReviewAssignment: vi.fn(),
}));

import {
  getAccessReview,
  listAccessReviews,
  startAccessReview,
  updateAccessReviewAssignment,
} from '../../lib/accessReviewApi.js';

const REVIEW = {
  id: 99,
  review_key: 'quarterly:2026-04-01',
  cadence: 'quarterly',
  period_start: '2026-04-01',
  period_end: '2026-06-30',
  status: 'in_progress',
  started_by_username: 'platform.admin',
  assignment_counts: {
    pending: 2,
    reviewed: 1,
    needs_change: 1,
  },
};

const DETAIL = {
  review: {
    ...REVIEW,
    snapshot: {
      generated_at: '2026-05-04T12:00:00Z',
      counts: {
        users: 4,
        platform_admins: 1,
        inactive_users: 1,
        home_assignments: 2,
        no_home_users: 1,
        stale_users: 1,
      },
      role_counts: { home_manager: 1, viewer: 1 },
    },
  },
  assignments: [
    {
      id: 501,
      review_id: 99,
      assignment_type: 'home_role',
      username: 'platform.admin',
      display_name: 'Platform Admin',
      active: true,
      is_platform_admin: true,
      home_name: 'Amberwood',
      role_id: 'home_manager',
      exception_flags: ['platform_admin'],
      status: 'pending',
      notes: '',
    },
    {
      id: 502,
      review_id: 99,
      assignment_type: 'user_exception',
      username: 'no.home',
      display_name: 'No Home',
      active: true,
      is_platform_admin: false,
      home_name: null,
      role_id: null,
      exception_flags: ['no_home'],
      status: 'needs_change',
      notes: 'Assign or deactivate',
    },
  ],
};

describe('AccessReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAccessReviews.mockResolvedValue({ reviews: [REVIEW], _total: 1 });
    getAccessReview.mockResolvedValue(DETAIL);
    startAccessReview.mockResolvedValue({ review: { ...REVIEW, id: 100 } });
    updateAccessReviewAssignment.mockImplementation(async (_reviewId, assignmentId, payload) => ({
      ...DETAIL.assignments.find(row => row.id === assignmentId),
      ...payload,
      reviewed_by_username: 'platform.admin',
    }));
  });

  it('renders review status and access exceptions clearly', async () => {
    renderWithProviders(<AccessReviews />, {
      route: '/access-reviews',
      user: { username: 'platform.admin', role: 'admin', isPlatformAdmin: true },
    });

    await waitFor(() => expect(screen.getByText('Platform admins')).toBeInTheDocument());
    expect(screen.getByText('Access Reviews')).toBeInTheDocument();
    expect(screen.getAllByText('2026-04-01 to 2026-06-30').length).toBeGreaterThan(0);
    expect(screen.getByText('No home')).toBeInTheDocument();
    expect(screen.getByText('Stale login')).toBeInTheDocument();
    expect(screen.getByText('Platform Admin')).toBeInTheDocument();
    expect(screen.getByText('platform admin')).toBeInTheDocument();
  });

  it('starts a quarterly review from the page action', async () => {
    renderWithProviders(<AccessReviews />, {
      route: '/access-reviews',
      user: { username: 'platform.admin', role: 'admin', isPlatformAdmin: true },
    });

    await waitFor(() => expect(listAccessReviews).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'Start review' }));

    expect(startAccessReview).toHaveBeenCalledWith({ cadence: 'quarterly' });
    await waitFor(() => expect(listAccessReviews).toHaveBeenCalledTimes(2));
  });

  it('updates assignment decisions and preserves reviewer context', async () => {
    renderWithProviders(<AccessReviews />, {
      route: '/access-reviews',
      user: { username: 'platform.admin', role: 'admin', isPlatformAdmin: true },
    });

    await waitFor(() => expect(screen.getByText('Platform Admin')).toBeInTheDocument());
    const select = screen.getByLabelText('Decision for platform.admin');
    await userEvent.selectOptions(select, 'reviewed');

    expect(updateAccessReviewAssignment).toHaveBeenCalledWith(99, 501, {
      status: 'reviewed',
      notes: '',
    });
    await waitFor(() => expect(screen.getByText('Reviewed by platform.admin')).toBeInTheDocument());
  });

  it('passes decision and exception filters to the detail API', async () => {
    renderWithProviders(<AccessReviews />, {
      route: '/access-reviews',
      user: { username: 'platform.admin', role: 'admin', isPlatformAdmin: true },
    });

    await waitFor(() => expect(getAccessReview).toHaveBeenCalledWith(
      99,
      { status: '', exception_only: true, limit: 250 },
      expect.any(Object),
    ));

    await userEvent.click(screen.getByLabelText('Exceptions only'));
    await userEvent.selectOptions(screen.getByLabelText('Filter by decision'), 'needs_change');

    await waitFor(() => expect(getAccessReview).toHaveBeenLastCalledWith(
      99,
      { status: 'needs_change', exception_only: false, limit: 250 },
      expect.any(Object),
    ));
  });

  it('keeps notes editable for a reviewed assignment', async () => {
    renderWithProviders(<AccessReviews />, {
      route: '/access-reviews',
      user: { username: 'platform.admin', role: 'admin', isPlatformAdmin: true },
    });

    await waitFor(() => expect(screen.getByText('No Home')).toBeInTheDocument());
    const row = screen.getByText('No Home').closest('tr');
    expect(within(row).getByLabelText('Notes for no.home')).toHaveValue('Assign or deactivate');
  });
});
