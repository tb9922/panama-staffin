import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import HandoverNotes from '../HandoverNotes.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getHandoverEntries: vi.fn(),
    getHandoverEntriesByRange: vi.fn(),
    createHandoverEntry: vi.fn(),
    updateHandoverEntry: vi.fn(),
    deleteHandoverEntry: vi.fn(),
    acknowledgeHandoverEntry: vi.fn(),
    getIncidents: vi.fn(),
    getRecordAttachments: vi.fn(),
    uploadRecordAttachment: vi.fn(),
    deleteRecordAttachment: vi.fn(),
    downloadRecordAttachment: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

vi.mock('../../hooks/useDirtyGuard', () => ({
  default: vi.fn(),
}));

import * as api from '../../lib/api.js';

const MOCK_ENTRIES = [
  {
    id: 'h-1',
    entry_date: '2026-03-08',
    shift: 'E',
    category: 'clinical',
    priority: 'urgent',
    content: 'Resident in room 5 had a fall at 08:30. Checked and no injuries, family notified.',
    author: 'Alice Smith',
    created_at: '2026-03-08T08:45:00Z',
    acknowledged_by: null,
    acknowledged_at: null,
    incident_id: null,
  },
  {
    id: 'h-2',
    entry_date: '2026-03-08',
    shift: 'L',
    category: 'operational',
    priority: 'info',
    content: 'Staff rota updated for next week.',
    author: 'Bob Jones',
    created_at: '2026-03-08T14:10:00Z',
    acknowledged_by: 'Carol Davis',
    acknowledged_at: '2026-03-08T14:30:00Z',
    incident_id: null,
  },
];

describe('HandoverNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
    api.getHandoverEntries.mockResolvedValue(MOCK_ENTRIES);
    api.getHandoverEntriesByRange.mockResolvedValue({
      rows: [
        {
          id: 'h-old',
          entry_date: '2026-03-06',
          shift: 'N',
          category: 'safety',
          priority: 'action',
          content: 'Monitor wound dressing stock before weekend handover.',
          author: 'Dawn Lead',
          created_at: '2026-03-06T21:00:00Z',
          acknowledged_by: null,
          acknowledged_at: null,
          incident_id: null,
        },
      ],
    });
    api.getIncidents.mockResolvedValue({ incidents: [] });
    api.createHandoverEntry.mockResolvedValue({ ...MOCK_ENTRIES[0], id: 'h-new' });
    api.acknowledgeHandoverEntry.mockResolvedValue({ ...MOCK_ENTRIES[0], acknowledged_by: 'Admin', acknowledged_at: '2026-03-08T09:00:00Z' });
    api.getRecordAttachments.mockResolvedValue([]);
  });

  it('renders the Handover Book heading', async () => {
    renderWithProviders(<HandoverNotes />);
    await waitFor(() => expect(screen.getByText('Handover Book')).toBeInTheDocument());
  });

  it('shows three shift sections', async () => {
    renderWithProviders(<HandoverNotes />);
    await waitFor(() => expect(screen.getAllByText('Early Shift').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Late Shift').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Night Shift').length).toBeGreaterThan(0);
  });

  it('displays handover entry content', async () => {
    renderWithProviders(<HandoverNotes />);
    await waitFor(() => expect(screen.getByText(/resident in room 5 had a fall/i)).toBeInTheDocument());
    expect(screen.getByText(/staff rota updated for next week/i)).toBeInTheDocument();
  });

  it('shows author names', async () => {
    renderWithProviders(<HandoverNotes />);
    await waitFor(() => expect(screen.getByText(/alice smith/i)).toBeInTheDocument());
    expect(screen.getByText(/bob jones/i)).toBeInTheDocument();
  });

  it('shows acknowledged status for entries', async () => {
    renderWithProviders(<HandoverNotes />);
    await waitFor(() => expect(screen.getByText(/acknowledged by carol davis/i)).toBeInTheDocument());
  });

  it('shows Add Entry buttons for admin', async () => {
    renderWithProviders(<HandoverNotes />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /add entry/i }).length).toBeGreaterThan(0));
  });

  it('hides Add Entry buttons for viewers', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
    renderWithProviders(<HandoverNotes />, { user: { username: 'viewer', role: 'viewer' }, canWrite: false });
    await waitFor(() => expect(screen.getAllByText('Early Shift').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /add entry/i })).not.toBeInTheDocument();
  });

  it('opens add modal when Add Entry is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HandoverNotes />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /add entry/i }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole('button', { name: /add entry/i })[0]);
    expect(screen.getByText('Add Handover Entry')).toBeInTheDocument();
    // Priority radio buttons appear in the modal (may also appear on existing entries)
    expect(screen.getAllByText('Urgent').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Action Required').length).toBeGreaterThan(0);
  });

  it('shows the handover evidence panel when editing an entry', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HandoverNotes />);
    await waitFor(() => expect(screen.getByText(/resident in room 5 had a fall/i)).toBeInTheDocument());
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await waitFor(() => expect(screen.getByText('Handover Evidence')).toBeInTheDocument());
  });

  it('lets the user filter handover entries by search text', async () => {
    const user = userEvent.setup();
    renderWithProviders(<HandoverNotes />);

    await waitFor(() => expect(screen.getByText(/resident in room 5 had a fall/i)).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/search content, author, incident, or shift/i), 'rota');

    expect(screen.queryByText(/resident in room 5 had a fall/i)).not.toBeInTheDocument();
    expect(screen.getByText(/staff rota updated for next week/i)).toBeInTheDocument();
  });

  it('shows the recent open-items carry-forward queue', async () => {
    renderWithProviders(<HandoverNotes />);

    await waitFor(() => expect(screen.getByText(/recent open items/i)).toBeInTheDocument());
    expect(screen.getByText(/monitor wound dressing stock before weekend handover/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bring into this day/i })).toBeInTheDocument();
  });

  it('guards against double submit while a save is in flight', async () => {
    const user = userEvent.setup();
    let resolveCreate;
    api.createHandoverEntry.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; })
    );

    renderWithProviders(<HandoverNotes />);

    await waitFor(() => expect(screen.getAllByRole('button', { name: /add entry/i }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole('button', { name: /add entry/i })[0]);
    await user.type(
      screen.getByPlaceholderText('Describe the situation, actions taken, or information to hand over'),
      'Follow up with the district nurse before lunch.'
    );
    await user.dblClick(screen.getByRole('button', { name: 'Save' }));

    expect(api.createHandoverEntry).toHaveBeenCalledTimes(1);

    resolveCreate?.({
      ...MOCK_ENTRIES[0],
      id: 'h-new',
      content: 'Follow up with the district nurse before lunch.',
    });

    await waitFor(() => expect(screen.queryByText('Add Handover Entry')).not.toBeInTheDocument());
  });
});
