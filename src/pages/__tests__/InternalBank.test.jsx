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
    useData.mockReturnValue({
      activeHome: 'test-home',
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'home_manager',
      staffId: null,
    });
  });

  it('shows the internal-bank loading message while searching', async () => {
    const user = userEvent.setup();
    api.getInternalBankCandidates.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<InternalBank />);
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(screen.getByText('Checking internal bank...')).toBeInTheDocument();
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
});
