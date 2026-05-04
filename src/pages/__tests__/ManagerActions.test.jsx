import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { useData } from '../../contexts/DataContext.jsx';
import ManagerActions from '../ManagerActions.jsx';

vi.mock('../../hooks/useConfirm.jsx', () => ({
  useConfirm: () => ({
    confirm: vi.fn(),
    ConfirmDialog: null,
  }),
}));

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getActionItems: vi.fn(),
    createActionItem: vi.fn(),
    updateActionItem: vi.fn(),
    deleteActionItem: vi.fn(),
    completeActionItem: vi.fn(),
    verifyActionItem: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

function makeAction(id) {
  return {
    id,
    title: `Action ${id}`,
    owner_name: 'Manager',
    owner_role: '',
    due_date: '2026-05-10',
    priority: 'medium',
    escalation_level: 0,
    status: 'open',
    source_type: 'standalone',
    evidence_required: false,
    version: 1,
  };
}

describe('ManagerActions', () => {
  beforeEach(() => {
    useData.mockReturnValue({
      activeHome: 'test-home',
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'home_manager',
      staffId: null,
    });
  });

  it('shows the result count and requests the next page instead of silently capping at 100', async () => {
    const user = userEvent.setup();
    const pageOne = Array.from({ length: 100 }, (_, index) => makeAction(index + 1));
    const pageTwo = [makeAction(101)];
    api.getActionItems
      .mockResolvedValueOnce({ actionItems: pageOne, _total: 125 })
      .mockResolvedValueOnce({ actionItems: pageTwo, _total: 125 });

    renderWithProviders(<ManagerActions />);

    await screen.findByText('Action 1');
    expect(screen.getByText('Showing 1-100 of 125 actions')).toBeInTheDocument();
    expect(api.getActionItems).toHaveBeenCalledWith('test-home', expect.objectContaining({
      limit: 100,
      offset: 0,
    }));

    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByText('Action 101');
    await waitFor(() => {
      expect(api.getActionItems).toHaveBeenLastCalledWith('test-home', expect.objectContaining({
        limit: 100,
        offset: 100,
      }));
    });
    expect(screen.getByText('Showing 101-101 of 125 actions')).toBeInTheDocument();
  });
});
