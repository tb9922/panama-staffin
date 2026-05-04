import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { useData } from '../../contexts/DataContext.jsx';
import AuditCalendar from '../AuditCalendar.jsx';

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
    getAuditTasks: vi.fn(),
    createAuditTask: vi.fn(),
    updateAuditTask: vi.fn(),
    deleteAuditTask: vi.fn(),
    completeAuditTask: vi.fn(),
    verifyAuditTask: vi.fn(),
    generateAuditTasks: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

function makeTask(id) {
  return {
    id,
    title: `Audit task ${id}`,
    category: 'governance',
    frequency: 'monthly',
    due_date: '2026-05-10',
    status: 'open',
    evidence_required: true,
    evidence_notes: '',
    manager_signed_off_at: null,
    qa_signed_off_at: null,
    version: 1,
  };
}

describe('AuditCalendar', () => {
  beforeEach(() => {
    useData.mockReturnValue({
      activeHome: 'test-home',
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'home_manager',
      staffId: null,
    });
  });

  it('shows the result count and requests subsequent audit-task pages', async () => {
    const user = userEvent.setup();
    const pageOne = Array.from({ length: 100 }, (_, index) => makeTask(index + 1));
    const pageTwo = [makeTask(101)];
    api.getAuditTasks
      .mockResolvedValueOnce({ tasks: pageOne, _total: 125 })
      .mockResolvedValueOnce({ tasks: pageTwo, _total: 125 });

    renderWithProviders(<AuditCalendar />);

    await screen.findByText('Audit task 1');
    expect(screen.getByText('Showing 1-100 of 125 tasks')).toBeInTheDocument();
    expect(api.getAuditTasks).toHaveBeenCalledWith('test-home', expect.objectContaining({
      limit: 100,
      offset: 0,
    }));

    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByText('Audit task 101');
    await waitFor(() => {
      expect(api.getAuditTasks).toHaveBeenLastCalledWith('test-home', expect.objectContaining({
        limit: 100,
        offset: 100,
      }));
    });
    expect(screen.getByText('Showing 101-101 of 125 tasks')).toBeInTheDocument();
  });
});
