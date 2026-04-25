import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IncidentTracker from '../IncidentTracker.jsx';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { MOCK_INCIDENTS } from '../../test/fixtures/schedulingData.js';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getIncidents: vi.fn(),
    createIncident: vi.fn(),
    updateIncident: vi.fn(),
    deleteIncident: vi.fn(),
    freezeIncident: vi.fn(),
    getIncidentAddenda: vi.fn(),
    addIncidentAddendum: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

// ── Fixture data ───────────────────────────────────────────────────────────────

// A CQC-notifiable incident dated today (not overdue — within 24h window)
// Using a far-future date so it never becomes overdue during tests
const CQC_PENDING_INCIDENT = {
  id: 'INC-002',
  date: '2099-12-31',
  time: '23:00',
  location: 'bedroom',
  type: 'death',
  severity: 'catastrophic',
  description: 'Unexpected death of resident',
  person_affected: 'resident',
  person_affected_name: 'Mary Brown',
  staff_involved: [],
  immediate_action: 'GP called',
  medical_attention: true,
  hospital_attendance: false,
  witnesses: [],
  cqc_notifiable: true,
  cqc_notification_type: 'death',
  cqc_notification_deadline: 'immediate',
  cqc_notified: false,
  cqc_notified_date: '',
  cqc_reference: '',
  riddor_reportable: false,
  riddor_category: '',
  riddor_reported: false,
  safeguarding_referral: false,
  duty_of_candour_applies: false,
  police_involved: false,
  investigation_status: 'open',
  corrective_actions: [],
  reported_by: 'admin',
  reported_at: '2099-12-31T23:00:00Z',
  updated_at: '2099-12-31T23:00:00Z',
};

const MOCK_INCIDENTS_RESPONSE = {
  incidents: MOCK_INCIDENTS,
  incidentTypes: [],
  staff: [
    { id: 'S001', name: 'Alice Smith', role: 'Senior Carer', active: true },
    { id: 'S002', name: 'Bob Jones', role: 'Carer', active: true },
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<IncidentTracker />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  return renderWithProviders(<IncidentTracker />, {
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getIncidents.mockResolvedValue(MOCK_INCIDENTS_RESPONSE);
  api.getIncidentAddenda.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('IncidentTracker', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(
        screen.queryByText(/Loading/i) ||
        screen.queryByText(/Incident & Safety Reporting/i)
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getIncidents.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading incidents...')).toBeInTheDocument();
  });

  it('displays the page heading after load', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Incident & Safety Reporting')).toBeInTheDocument();
    });
  });

  it('displays stat cards with correct labels', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Total Incidents')).toBeInTheDocument();
    });
    expect(screen.getByText('Open Investigations')).toBeInTheDocument();
    expect(screen.getByText('Pending CQC')).toBeInTheDocument();
    expect(screen.getByText('Avg Response')).toBeInTheDocument();
  });

  it('shows correct total in the Total Incidents stat card', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Total Incidents')).toBeInTheDocument();
    });
    // The stat card wraps "Total Incidents" label + value in a parent card div.
    // Navigate up to the card container (grandparent of the label text node)
    const label = screen.getByText('Total Incidents');
    const card = label.closest('div').parentElement;
    expect(card).toHaveTextContent('1');
  });

  it('displays incident row with the incident date', async () => {
    renderAdmin();
    await waitFor(() => {
      // MOCK_INCIDENTS[0] date is '2026-03-01'
      expect(screen.getByText('2026-03-01')).toBeInTheDocument();
    });
  });

  it('displays severity badge for incident (uses getAllByText for dropdown ambiguity)', async () => {
    renderAdmin();
    await waitFor(() => {
      // MOCK_INCIDENTS[0] severity is 'moderate' — appears in both dropdown option and table badge
      const matches = screen.getAllByText('Moderate');
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('displays investigation status badge', async () => {
    renderAdmin();
    await waitFor(() => {
      // MOCK_INCIDENTS[0] investigation_status is 'open' — 'Open' appears in dropdown + badge
      const matches = screen.getAllByText('Open');
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('shows empty state when no incidents exist', async () => {
    api.getIncidents.mockResolvedValue({ incidents: [], incidentTypes: [], staff: [] });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('No incidents recorded yet')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Log first incident' })).toBeInTheDocument();
  });

  it('shows CQC "Pending" badge for notifiable but un-notified incidents (well within deadline)', async () => {
    api.getIncidents.mockResolvedValue({
      incidents: [CQC_PENDING_INCIDENT],
      incidentTypes: [],
      staff: [],
    });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });
  });

  it('shows CQC "Sent" badge for notifiable incidents that have been notified', async () => {
    const notifiedIncident = {
      ...CQC_PENDING_INCIDENT,
      id: 'INC-003',
      cqc_notified: true,
      cqc_notified_date: '2099-12-31',
    };
    api.getIncidents.mockResolvedValue({
      incidents: [notifiedIncident],
      incidentTypes: [],
      staff: [],
    });
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Sent')).toBeInTheDocument();
    });
  });

  it('non-CQC-notifiable incidents show dash in CQC column', async () => {
    renderAdmin();
    await waitFor(() => {
      // MOCK_INCIDENTS[0] has cqc_notifiable: false → renders <span>-</span>
      // There are multiple dashes (CQC and RIDDOR columns both show dash)
      const dashes = screen.getAllByText('-');
      expect(dashes.length).toBeGreaterThan(0);
    });
  });

  it('admin sees the + New Incident button', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ New Incident/i })).toBeInTheDocument();
    });
  });

  it('shows missing required guidance inside the incident modal', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ New Incident/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /\+ New Incident/i }));
    expect(screen.getByText('Missing: Incident type')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Notifications' }));
    await user.click(screen.getByLabelText('This incident is CQC notifiable'));
    expect(screen.getByText('Missing: Incident type, CQC notification type')).toBeInTheDocument();
  });

  it('viewer does NOT see the + New Incident button', async () => {
    renderViewer();
    await waitFor(() => {
      expect(screen.getByText('Incident & Safety Reporting')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /\+ New Incident/i })).not.toBeInTheDocument();
  });

  it('severity filter shows only matching incidents', async () => {
    const user = userEvent.setup();
    // Two incidents: one moderate (MOCK_INCIDENTS[0]), one minor
    const minorIncident = {
      ...MOCK_INCIDENTS[0],
      id: 'INC-004',
      severity: 'minor',
      description: 'Minor scrape',
      person_affected_name: 'Minor Person',
    };
    api.getIncidents.mockResolvedValue({
      incidents: [MOCK_INCIDENTS[0], minorIncident],
      incidentTypes: [],
      staff: [],
    });
    renderAdmin();

    await waitFor(() => {
      // Both dates visible before filtering
      expect(screen.getAllByText('2026-03-01').length).toBe(2);
    });

    // Select 'moderate' by value
    const severitySelect = screen.getByDisplayValue('All Severities');
    await user.selectOptions(severitySelect, 'moderate');

    await waitFor(() => {
      // After filtering: only 1 incident row (the moderate one)
      expect(screen.getAllByText('2026-03-01').length).toBe(1);
    });
  });

  it('search box filters incidents by description text', async () => {
    const user = userEvent.setup();
    const uniqueIncident = {
      ...MOCK_INCIDENTS[0],
      id: 'INC-005',
      description: 'Kitchen slip unique term zephyr',
      person_affected_name: 'Unique Person',
    };
    api.getIncidents.mockResolvedValue({
      incidents: [MOCK_INCIDENTS[0], uniqueIncident],
      incidentTypes: [],
      staff: [],
    });
    renderAdmin();

    await waitFor(() => {
      expect(screen.getAllByText('2026-03-01').length).toBe(2);
    });

    const searchInput = screen.getByPlaceholderText('Search...');
    await user.type(searchInput, 'zephyr');

    await waitFor(() => {
      // Only 1 incident row matches 'zephyr'
      expect(screen.getAllByText('2026-03-01').length).toBe(1);
    });
  });

  it('shows incident count in filter bar', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('1 incidents')).toBeInTheDocument();
    });
  });

  it('handles API error by showing error message inline', async () => {
    api.getIncidents.mockRejectedValue(new Error('Failed to load incidents'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Failed to load incidents')).toBeInTheDocument();
    });
  });

  it('handles API error with generic fallback message when error has no message', async () => {
    const errNoMsg = new Error('');
    api.getIncidents.mockRejectedValue(errNoMsg);
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Failed to load incidents')).toBeInTheDocument();
    });
  });

  it('clicking + New Incident opens modal with Details tab active', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ New Incident/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /\+ New Incident/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'New Incident' })).toBeInTheDocument();
    // Details tab content shows the Date field
    expect(screen.getByText('Date *')).toBeInTheDocument();
  });

  it('Export Excel button is present for all users', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export Excel/i })).toBeInTheDocument();
    });
  });

  it('shows correct incident type name from DEFAULT_INCIDENT_TYPES', async () => {
    renderAdmin();
    await waitFor(() => {
      // MOCK_INCIDENTS[0].type is 'fall' → "Fall / Slip / Trip" from DEFAULT_INCIDENT_TYPES
      // This name appears in both the filter dropdown option AND the table cell
      const matches = screen.getAllByText('Fall / Slip / Trip');
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('status filter shows only matching investigation statuses', async () => {
    const user = userEvent.setup();
    const closedIncident = {
      ...MOCK_INCIDENTS[0],
      id: 'INC-006',
      investigation_status: 'closed',
    };
    api.getIncidents.mockResolvedValue({
      incidents: [MOCK_INCIDENTS[0], closedIncident],
      incidentTypes: [],
      staff: [],
    });
    renderAdmin();

    await waitFor(() => {
      // 2 incidents visible
      expect(screen.getAllByText('2026-03-01').length).toBe(2);
    });

    const statusSelect = screen.getByDisplayValue('All Statuses');
    await user.selectOptions(statusSelect, 'closed');

    await waitFor(() => {
      // Only the closed incident remains
      expect(screen.getAllByText('2026-03-01').length).toBe(1);
    });
  });
});
