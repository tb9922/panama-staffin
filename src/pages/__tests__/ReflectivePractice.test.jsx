import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { useData } from '../../contexts/DataContext.jsx';
import ReflectivePractice from '../ReflectivePractice.jsx';

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
    getReflectivePractice: vi.fn(),
    createReflectivePractice: vi.fn(),
    updateReflectivePractice: vi.fn(),
    deleteReflectivePractice: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

const sampleEntry = {
  id: 42,
  staff_id: 'S100',
  practice_date: '2026-05-08',
  facilitator: 'Deputy manager',
  category: 'reflective_practice',
  topic: 'Falls reflection',
  reflection: 'Reviewed trend.',
  learning_outcome: 'Night checks updated.',
  wellbeing_notes: '',
  action_summary: '',
  version: 5,
};

describe('ReflectivePractice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    api.getReflectivePractice.mockResolvedValue({ entries: [], _total: 0 });
    api.createReflectivePractice.mockResolvedValue({ id: 99, version: 1 });
    api.updateReflectivePractice.mockResolvedValue({ ...sampleEntry, version: 6 });
    api.deleteReflectivePractice.mockResolvedValue({ ok: true });
    useData.mockReturnValue({
      activeHome: 'test-home',
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'home_manager',
      staffId: null,
    });
  });

  it('shows a no-home state without calling the reflective-practice API', async () => {
    useData.mockReturnValue({
      activeHome: '',
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'home_manager',
      staffId: null,
    });

    renderWithProviders(<ReflectivePractice />);

    expect(screen.getByText('No home selected')).toBeInTheDocument();
    expect(screen.getByText('Select a home before opening reflective practice.')).toBeInTheDocument();
    expect(api.getReflectivePractice).not.toHaveBeenCalled();
  });

  it('creates a reflection with trimmed nullable text', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReflectivePractice />);

    await screen.findByText('No reflections');
    await user.click(screen.getByRole('button', { name: 'New Reflection' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(screen.getByLabelText('Topic'), '  Falls learning huddle  ');
    await user.type(screen.getByLabelText('Facilitator'), '  Deputy manager  ');
    await user.type(screen.getByLabelText('Reflection'), '  Reviewed trend.  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(api.createReflectivePractice).toHaveBeenCalledWith('test-home', expect.objectContaining({
        topic: 'Falls learning huddle',
        facilitator: 'Deputy manager',
        reflection: 'Reviewed trend.',
        learning_outcome: null,
      }));
    });
  });

  it('passes the row version when deleting a reflection', async () => {
    const user = userEvent.setup();
    api.getReflectivePractice.mockResolvedValue({ entries: [sampleEntry], _total: 1 });

    renderWithProviders(<ReflectivePractice />);

    await user.click(await screen.findByRole('button', { name: 'Falls reflection' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(api.deleteReflectivePractice).toHaveBeenCalledWith('test-home', 42, 5);
    });
  });
});
