import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { useData } from '../../contexts/DataContext.jsx';
import ManagerActions from '../ManagerActions.jsx';

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));

vi.mock('../../hooks/useConfirm.jsx', () => ({
  useConfirm: () => ({
    confirm: confirmMock,
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
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    api.getCurrentHome.mockReturnValue('test-home');
    api.getActionItems.mockResolvedValue({ actionItems: [], _total: 0 });
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
    const allRows = Array.from({ length: 125 }, (_, index) => makeAction(index + 1));
    const pageTwo = [makeAction(101)];
    api.getActionItems
      .mockResolvedValueOnce({ actionItems: pageOne, _total: 125 })
      .mockResolvedValueOnce({ actionItems: allRows, _total: 125 })
      .mockResolvedValueOnce({ actionItems: pageTwo, _total: 125 })
      .mockResolvedValueOnce({ actionItems: allRows, _total: 125 });

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
      expect(api.getActionItems).toHaveBeenCalledWith('test-home', expect.objectContaining({
        limit: 100,
        offset: 100,
      }));
    });
    expect(screen.getByText('Showing 101-101 of 125 actions')).toBeInTheDocument();
  });

  it('shows a no-home state without calling the action API', async () => {
    api.getCurrentHome.mockReturnValue('');
    useData.mockReturnValue({
      activeHome: '',
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'home_manager',
      staffId: null,
    });

    renderWithProviders(<ManagerActions />);

    expect(await screen.findByText('No home selected')).toBeInTheDocument();
    expect(screen.getByText('Select a home before opening manager actions.')).toBeInTheDocument();
    expect(api.getActionItems).not.toHaveBeenCalled();
  });

  it('creates an owned action with trimmed text from the modal', async () => {
    const user = userEvent.setup();
    api.createActionItem.mockResolvedValue({ id: 77, version: 1 });

    renderWithProviders(<ManagerActions />);

    await screen.findByText('No actions found');
    await user.click(screen.getAllByRole('button', { name: 'New Action' })[0]);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(screen.getByLabelText('Title'), '  Check falls trend  ');
    await user.type(screen.getByLabelText('Due date'), '2026-05-31');
    await user.type(screen.getByLabelText('Owner role'), '  Home manager  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(api.createActionItem).toHaveBeenCalledWith('test-home', expect.objectContaining({
        title: 'Check falls trend',
        due_date: '2026-05-31',
        owner_role: 'Home manager',
      }));
    });
  });

  it('passes the row version when deleting an action', async () => {
    const user = userEvent.setup();
    api.getActionItems.mockResolvedValue({ actionItems: [{ ...makeAction(44), version: 6 }], _total: 1 });
    api.deleteActionItem.mockResolvedValue({ ok: true });

    renderWithProviders(<ManagerActions />);

    await user.click(await screen.findByRole('button', { name: 'Action 44' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(api.deleteActionItem).toHaveBeenCalledWith('test-home', 44, 6);
    });
  });
});
