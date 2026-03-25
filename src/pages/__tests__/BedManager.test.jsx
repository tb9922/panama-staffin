import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import BedManager from '../BedManager.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getBeds: vi.fn(),
    getBedSummary: vi.fn(),
    getBedHistory: vi.fn(),
    createBed: vi.fn(),
    updateBed: vi.fn(),
    deleteBed: vi.fn(),
    transitionBedStatus: vi.fn(),
    revertBedTransition: vi.fn(),
    moveBedResident: vi.fn(),
    getFinanceResidents: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

const MOCK_SUMMARY = {
  total_beds: 3,
  occupied: 2,
  available: 1,
  occupancy_rate: 67,
  vacancy_cost_per_week: 1200,
};

const MOCK_BEDS = [
  {
    id: 'bed-1',
    room_number: '101',
    room_name: 'Bluebell',
    room_type: 'single',
    floor: '1',
    status: 'occupied',
    resident_name: 'Mrs Joan Smith',
    status_since: '2025-06-01',
    updated_at: '2026-03-01T00:00:00Z',
  },
  {
    id: 'bed-2',
    room_number: '102',
    room_name: 'Daisy',
    room_type: 'en_suite',
    floor: '1',
    status: 'available',
    resident_name: null,
    status_since: null,
    updated_at: '2026-03-01T00:00:00Z',
  },
  {
    id: 'bed-3',
    room_number: '201',
    room_name: 'Rose',
    room_type: 'nursing',
    floor: '2',
    status: 'hospital_hold',
    resident_name: 'Mr Thomas',
    status_since: '2025-11-15',
    updated_at: '2026-03-01T00:00:00Z',
  },
];

describe('BedManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
    api.getBeds.mockResolvedValue({ beds: MOCK_BEDS });
    api.getBedSummary.mockResolvedValue(MOCK_SUMMARY);
    api.getFinanceResidents.mockResolvedValue({ rows: [] });
    api.getBedHistory.mockResolvedValue({ transitions: [] });
  });

  it('shows loading state initially', () => {
    api.getBeds.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<BedManager />);
    expect(screen.getByText(/loading beds/i)).toBeInTheDocument();
  });

  it('renders page heading after load', async () => {
    renderWithProviders(<BedManager />);
    await waitFor(() => expect(screen.getByText('Beds & Occupancy')).toBeInTheDocument());
  });

  it('shows occupancy KPI cards', async () => {
    renderWithProviders(<BedManager />);
    await waitFor(() => expect(screen.getByText('Occupancy')).toBeInTheDocument());
    expect(screen.getByText('Total Beds')).toBeInTheDocument();
    // "Occupied" and "Available" appear as both KPI labels and status badges — use getAllByText
    expect(screen.getAllByText('Occupied').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
    // Occupancy rate from summary
    expect(screen.getByText('67%')).toBeInTheDocument();
  });

  it('renders beds table with room numbers and status', async () => {
    renderWithProviders(<BedManager />);
    await waitFor(() => expect(screen.getByText('101')).toBeInTheDocument());
    expect(screen.getByText('102')).toBeInTheDocument();
    expect(screen.getByText('201')).toBeInTheDocument();
    // Status badges — "Occupied" and "Available" also match KPI labels so use getAllByText
    expect(screen.getAllByText('Occupied').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
    // "Hospital Hold" appears as both status badge and transition button
    expect(screen.getAllByText('Hospital Hold').length).toBeGreaterThan(0);
  });

  it('shows resident names for occupied beds', async () => {
    renderWithProviders(<BedManager />);
    await waitFor(() => expect(screen.getByText('Mrs Joan Smith')).toBeInTheDocument());
    expect(screen.getByText('Mr Thomas')).toBeInTheDocument();
  });

  it('labels the room name column clearly', async () => {
    renderWithProviders(<BedManager />);
    await waitFor(() => expect(screen.getByText('Room Name')).toBeInTheDocument());
    expect(screen.getByText('Resident')).toBeInTheDocument();
  });

  it('shows Add Bed button for admins', async () => {
    renderWithProviders(<BedManager />);
    await waitFor(() => expect(screen.getByRole('button', { name: /add bed/i })).toBeInTheDocument());
  });

  it('hides Add Bed button for viewers', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
    renderWithProviders(<BedManager />, { user: { username: 'viewer', role: 'viewer' }, canWrite: false });
    await waitFor(() => expect(screen.getByText('101')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /add bed/i })).not.toBeInTheDocument();
  });

  it('opens Add Bed modal on button click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BedManager />);
    await waitFor(() => expect(screen.getByRole('button', { name: /add bed/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /add bed/i }));
    expect(screen.getByText('Room Number *')).toBeInTheDocument();
    expect(screen.getByText('Room Type')).toBeInTheDocument();
  });

  it('opens the edit modal and saves bed metadata changes', async () => {
    const user = userEvent.setup();
    api.updateBed.mockResolvedValue({
      ...MOCK_BEDS[0],
      room_name: 'Bluebell Suite',
      floor: 'Ground',
      notes: 'Refreshed room details',
    });

    renderWithProviders(<BedManager />);

    await waitFor(() => expect(screen.getByLabelText('Edit bed 101')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Edit bed 101'));

    const dialog = screen.getByRole('dialog', { name: /edit bed - room 101/i });

    const roomNameInput = within(dialog).getByDisplayValue('Bluebell');
    await user.clear(roomNameInput);
    await user.type(roomNameInput, 'Bluebell Suite');

    const floorInput = within(dialog).getByDisplayValue('1');
    await user.clear(floorInput);
    await user.type(floorInput, 'Ground');

    const textboxes = within(dialog).getAllByRole('textbox');
    const notesInput = textboxes[textboxes.length - 1];
    await user.type(notesInput, 'Refreshed room details');

    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(api.updateBed).toHaveBeenCalledWith('test-home', 'bed-1', {
      room_number: '101',
      room_name: 'Bluebell Suite',
      room_type: 'single',
      floor: 'Ground',
      notes: 'Refreshed room details',
      clientUpdatedAt: '2026-03-01T00:00:00Z',
    }));
  });

  it('shows delete action only for available beds and deletes after confirmation', async () => {
    const user = userEvent.setup();
    api.deleteBed.mockResolvedValue({ ok: true });

    renderWithProviders(<BedManager />);

    await waitFor(() => expect(screen.getByLabelText('Delete bed 102')).toBeInTheDocument());
    expect(screen.queryByLabelText('Delete bed 101')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Delete bed 102'));
    const dialog = screen.getByRole('dialog', { name: /delete bed - room 102/i });

    await user.click(within(dialog).getByRole('button', { name: /^Delete Bed$/i }));

    await waitFor(() => expect(api.deleteBed).toHaveBeenCalledWith(
      'test-home',
      'bed-2',
      '2026-03-01T00:00:00Z',
    ));
  });

  it('shows error banner on API failure', async () => {
    api.getBeds.mockRejectedValue(new Error('Database error'));
    renderWithProviders(<BedManager />);
    await waitFor(() => expect(screen.getByText('Database error')).toBeInTheDocument());
  });

  it('keeps resident handoff context from the Residents page', async () => {
    const user = userEvent.setup();
    api.getFinanceResidents.mockResolvedValue({
      rows: [{ id: 42, resident_name: 'Mrs Alice Walker' }],
    });

    renderWithProviders(<BedManager />, { route: '/beds?residentId=42' });

    await waitFor(() => expect(screen.getByText(/assign a bed for/i)).toBeInTheDocument());
    expect(screen.getByText(/Mrs Alice Walker/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Admit' }));

    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('42'));
  });
});
