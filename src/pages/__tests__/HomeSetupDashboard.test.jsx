import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeSetupDashboard from '../HomeSetupDashboard.jsx';

vi.mock('../../lib/homeSetupApi.js', () => ({
  getHomeSetupCompleteness: vi.fn(),
}));

import { getHomeSetupCompleteness } from '../../lib/homeSetupApi.js';

const PAYLOAD = {
  summary: {
    home_count: 2,
    average_completion_pct: 72,
    complete_homes: 0,
    incomplete_homes: 2,
  },
  homes: [
    {
      home_id: 1,
      home_name: 'Zeta Home',
      completion_pct: 80,
      completed_checks: 6,
      total_checks: 8,
      missing_items: ['Add evidence'],
      checks: {
        evidence_baseline: { id: 'evidence_baseline', label: 'Evidence baseline', score_pct: 0, missing_items: ['Add evidence'], details: {} },
      },
    },
    {
      home_id: 2,
      home_name: 'Alpha Home',
      completion_pct: 40,
      completed_checks: 3,
      total_checks: 8,
      missing_items: ['Add staff'],
      checks: {
        staff_roster: { id: 'staff_roster', label: 'Staff roster', score_pct: 0, missing_items: ['Add staff'], details: {} },
      },
    },
  ],
};

describe('HomeSetupDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHomeSetupCompleteness.mockResolvedValue(PAYLOAD);
  });

  it('does not show placeholder summary cards while loading', () => {
    getHomeSetupCompleteness.mockReturnValue(new Promise(() => {}));
    render(<HomeSetupDashboard />);

    expect(screen.getByText('Loading setup completeness...')).toBeInTheDocument();
    expect(screen.queryByText('Average completion')).not.toBeInTheDocument();
  });

  it('sorts homes by lowest setup completion first', async () => {
    render(<HomeSetupDashboard />);

    expect(await screen.findByText('Average completion')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings[0]).toContain('Alpha Home');
    expect(headings[1]).toContain('Zeta Home');
  });

  it('refreshes setup completeness on demand', async () => {
    const user = userEvent.setup();
    render(<HomeSetupDashboard />);

    await screen.findByText('Average completion');
    await user.click(screen.getByRole('button', { name: /^Refresh$/i }));

    await waitFor(() => expect(getHomeSetupCompleteness).toHaveBeenCalledTimes(2));
  });

  it('shows the empty state without summary cards when no homes are returned', async () => {
    getHomeSetupCompleteness.mockResolvedValue({ summary: { home_count: 0 }, homes: [] });
    render(<HomeSetupDashboard />);

    expect(await screen.findByText('No homes available')).toBeInTheDocument();
    expect(screen.queryByText('Average completion')).not.toBeInTheDocument();
  });
});
