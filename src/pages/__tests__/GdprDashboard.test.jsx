import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import GdprDashboard from '../GdprDashboard.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getDataRequests: vi.fn(),
    createDataRequest: vi.fn(),
    updateDataRequest: vi.fn(),
    gatherRequestData: vi.fn(),
    executeErasure: vi.fn(),
    getDataBreaches: vi.fn(),
    createDataBreach: vi.fn(),
    updateDataBreach: vi.fn(),
    assessBreach: vi.fn(),
    getRetentionSchedule: vi.fn(),
    scanRetention: vi.fn(),
    getConsentRecords: vi.fn(),
    createConsentRecord: vi.fn(),
    updateConsentRecord: vi.fn(),
    getDPComplaints: vi.fn(),
    createDPComplaint: vi.fn(),
    updateDPComplaint: vi.fn(),
    getAccessLog: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../lib/gdpr.js', async () => {
  const actual = await vi.importActual('../../lib/gdpr.js');
  return {
    ...actual,
    calculateGdprComplianceScore: vi.fn(() => ({
      score: 85,
      band: 'good',
      issues: [],
    })),
  };
});

import * as api from '../../lib/api.js';

const EMPTY_DATA = {
  requests: [],
  breaches: [],
  retention: [
    { data_category: 'Staff records', retention_period: '7 years', retention_basis: 'Legal', special_category: false, applies_to_table: 'staff' },
  ],
  consent: [],
  complaints: [],
  accessLog: [],
};

function mockAllApis(overrides = {}) {
  const d = { ...EMPTY_DATA, ...overrides };
  api.getDataRequests.mockResolvedValue(d.requests);
  api.getDataBreaches.mockResolvedValue(d.breaches);
  api.getRetentionSchedule.mockResolvedValue(d.retention);
  api.getConsentRecords.mockResolvedValue(d.consent);
  api.getDPComplaints.mockResolvedValue(d.complaints);
  api.getAccessLog.mockResolvedValue(d.accessLog);
}

describe('GdprDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
    mockAllApis();
  });

  it('shows loading state initially', () => {
    // All promises pending → loading state shown
    api.getDataRequests.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<GdprDashboard />);
    expect(screen.getByText(/loading gdpr data/i)).toBeInTheDocument();
  });

  it('renders the page heading after load', async () => {
    renderWithProviders(<GdprDashboard />);
    await waitFor(() => expect(screen.getByText('GDPR & Data Protection')).toBeInTheDocument());
  });

  it('renders tab bar with all sections', async () => {
    renderWithProviders(<GdprDashboard />);
    await waitFor(() => expect(screen.getByText('Overview')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Data Requests' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Breaches' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retention' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Consent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complaints' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Access Log' })).toBeInTheDocument();
  });

  it('shows compliance score on overview tab', async () => {
    renderWithProviders(<GdprDashboard />);
    await waitFor(() => expect(screen.getByText(/85\/100/i)).toBeInTheDocument());
    expect(screen.getByText(/compliance score/i)).toBeInTheDocument();
  });

  it('shows error message on API failure', async () => {
    api.getDataRequests.mockRejectedValue(new Error('API down'));
    renderWithProviders(<GdprDashboard />);
    await waitFor(() => expect(screen.getByText('API down')).toBeInTheDocument());
  });

  it('switches to Data Requests tab and shows empty state', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GdprDashboard />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Data Requests' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Data Requests' }));
    expect(screen.getByText('No data requests')).toBeInTheDocument();
  });

  it('shows New Request button for admin on Data Requests tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GdprDashboard />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Data Requests' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Data Requests' }));
    expect(screen.getByRole('button', { name: 'New Request' })).toBeInTheDocument();
  });

  it('shows data breaches empty state on Breaches tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GdprDashboard />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Breaches' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Breaches' }));
    expect(screen.getByText('No data breaches recorded')).toBeInTheDocument();
  });
});
