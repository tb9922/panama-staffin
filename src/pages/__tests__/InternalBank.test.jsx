import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { useData } from '../../contexts/DataContext.jsx';
import InternalBank from '../InternalBank.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getInternalBankCandidates: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

describe('InternalBank', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useData.mockReturnValue({
      activeHome: 'test-home',
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'home_manager',
      staffId: null,
    });
  });

  it('shows a no-home state without searching', async () => {
    useData.mockReturnValue({
      activeHome: '',
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'home_manager',
      staffId: null,
    });

    renderWithProviders(<InternalBank />);

    expect(screen.getByText('No home selected')).toBeInTheDocument();
    expect(screen.getByText('Select a home before searching the internal bank.')).toBeInTheDocument();
    expect(api.getInternalBankCandidates).not.toHaveBeenCalled();
  });

  it('shows the internal-bank loading message while searching', async () => {
    const user = userEvent.setup();
    api.getInternalBankCandidates.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<InternalBank />);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(screen.getByText('Checking internal bank...')).toBeInTheDocument();
  });

  it('disables search when hours are invalid', async () => {
    const user = userEvent.setup();

    renderWithProviders(<InternalBank />);
    await user.clear(screen.getByLabelText('Hours'));

    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    expect(api.getInternalBankCandidates).not.toHaveBeenCalled();
  });

  it('shows the empty-state description when no candidates match', async () => {
    const user = userEvent.setup();
    api.getInternalBankCandidates.mockResolvedValue({ candidates: [] });

    renderWithProviders(<InternalBank />);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByText('No matching internal-bank staff were available for this search.')).toBeInTheDocument();
    });
  });

  it('renders candidate counts and narrow eligibility details', async () => {
    const user = userEvent.setup();
    api.getInternalBankCandidates.mockResolvedValue({
      total: 1,
      viable_count: 1,
      candidates: [{
        id: 'S100',
        home_id: 1,
        name: 'Ava Carter',
        home_name: 'Test Home',
        role: 'Carer',
        availability: 'available',
        availability_detail: 'Not rostered',
        training_status: 'ok',
        fatigue_status: 'ok',
        viable: true,
        blockers: [],
        warnings: [],
      }],
    });

    renderWithProviders(<InternalBank />);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Ava Carter')).toBeInTheDocument();
    expect(screen.getByText('Candidates')).toBeInTheDocument();
    expect(screen.getAllByText('Viable').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('None')).toBeInTheDocument();
  });
});
