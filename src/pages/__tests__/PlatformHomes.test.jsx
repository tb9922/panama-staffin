import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import PlatformHomes from '../PlatformHomes.jsx';

// Mock DataContext so we don't need the full DataProvider
vi.mock('../../contexts/DataContext.jsx', () => ({
  useData: vi.fn(() => ({
    refreshHomes: vi.fn(),
    switchHome: vi.fn(),
  })),
}));

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    listPlatformHomes: vi.fn(),
    createPlatformHome: vi.fn(),
    updatePlatformHome: vi.fn(),
    deletePlatformHome: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

const MOCK_HOMES = [
  {
    id: 1,
    name: 'Oakwood Care Home',
    slug: 'oakwood_care_home',
    beds: 30,
    careType: 'residential',
    staffCount: 20,
    userCount: 3,
    updatedAt: '2026-03-01T12:00:00Z',
  },
  {
    id: 2,
    name: 'Riverside Lodge',
    slug: 'riverside_lodge',
    beds: 40,
    careType: 'nursing',
    staffCount: 28,
    userCount: 5,
    updatedAt: '2026-02-15T10:00:00Z',
  },
];

describe('PlatformHomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listPlatformHomes.mockResolvedValue({ homes: MOCK_HOMES });
    api.createPlatformHome.mockResolvedValue({ id: 3, slug: 'new_home' });
    api.updatePlatformHome.mockResolvedValue({});
    api.deletePlatformHome.mockResolvedValue({});
  });

  it('shows loading state initially', () => {
    api.listPlatformHomes.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<PlatformHomes />);
    expect(screen.getByText(/loading homes/i)).toBeInTheDocument();
  });

  it('renders the page heading after load', async () => {
    renderWithProviders(<PlatformHomes />);
    await waitFor(() => expect(screen.getByText('Manage Homes')).toBeInTheDocument());
  });

  it('displays homes in the table', async () => {
    renderWithProviders(<PlatformHomes />);
    await waitFor(() => expect(screen.getByText('Oakwood Care Home')).toBeInTheDocument());
    expect(screen.getByText('Riverside Lodge')).toBeInTheDocument();
    expect(screen.getByText('oakwood_care_home')).toBeInTheDocument();
    expect(screen.getByText('riverside_lodge')).toBeInTheDocument();
  });

  it('shows staff and user counts', async () => {
    renderWithProviders(<PlatformHomes />);
    await waitFor(() => expect(screen.getByText('Oakwood Care Home')).toBeInTheDocument());
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
  });

  it('shows Add Home button', async () => {
    renderWithProviders(<PlatformHomes />);
    await waitFor(() => expect(screen.getByRole('button', { name: /add home/i })).toBeInTheDocument());
  });

  it('opens Create Home modal when Add Home is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlatformHomes />);
    await waitFor(() => expect(screen.getByRole('button', { name: /add home/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /add home/i }));
    // Modal-specific fields visible after open
    expect(screen.getByText('Home Name *')).toBeInTheDocument();
    // Cycle start date is only in the modal, not the table
    expect(screen.getByText('Cycle Start Date *')).toBeInTheDocument();
    // Slug auto-generate label
    expect(screen.getByText('Slug (auto-generated)')).toBeInTheDocument();
  });

  it('shows error banner on API failure', async () => {
    api.listPlatformHomes.mockRejectedValue(new Error('Forbidden'));
    renderWithProviders(<PlatformHomes />);
    await waitFor(() => expect(screen.getByText('Forbidden')).toBeInTheDocument());
  });

  it('shows empty state when no homes configured', async () => {
    api.listPlatformHomes.mockResolvedValue({ homes: [] });
    renderWithProviders(<PlatformHomes />);
    await waitFor(() => expect(screen.getByText('No homes configured')).toBeInTheDocument());
  });
});
