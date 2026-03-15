import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { MOCK_SCHEDULING_DATA } from '../../test/fixtures/schedulingData.js';
import Reports from '../Reports.jsx';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getSchedulingData: vi.fn(),
    logReportDownload: vi.fn(),
  };
});

vi.mock('../../hooks/useLiveDate.js', () => ({
  useLiveDate: vi.fn(() => '2026-03-08'),
}));

// Stub pdfReports so we don't execute jspdf in jsdom
vi.mock('../../lib/pdfReports.js', () => ({
  generateRosterPDF: vi.fn(),
  generateCostPDF: vi.fn(),
  generateCoveragePDF: vi.fn(),
  generateStaffPDF: vi.fn(),
  generateBoardPackPDF: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import * as api from '../../lib/api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getSchedulingData.mockResolvedValue(MOCK_SCHEDULING_DATA);
  return renderWithProviders(<Reports />, {
    user: { username: 'admin', role: 'admin' },
  });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  api.getSchedulingData.mockResolvedValue(MOCK_SCHEDULING_DATA);
  return renderWithProviders(<Reports />, {
    user: { username: 'viewer', role: 'viewer' }, canWrite: false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  });

  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('PDF Reports')).toBeInTheDocument()
    );
  });

  it('shows loading text while data is being fetched', () => {
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<Reports />, { user: { username: 'admin', role: 'admin' } });
    expect(screen.getByText('Loading report data...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getSchedulingData.mockRejectedValue(new Error('Data unavailable'));
    renderWithProviders(<Reports />, { user: { username: 'admin', role: 'admin' } });
    await waitFor(() =>
      expect(screen.getByText('Data unavailable')).toBeInTheDocument()
    );
    expect(screen.queryByText('PDF Reports')).not.toBeInTheDocument();
  });

  it('admin sees all five report type cards', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('PDF Reports')).toBeInTheDocument()
    );
    expect(screen.getByText('Weekly Roster')).toBeInTheDocument();
    expect(screen.getByText('Monthly Cost Report')).toBeInTheDocument();
    expect(screen.getByText('Coverage & Escalation')).toBeInTheDocument();
    expect(screen.getByText('Staff Register')).toBeInTheDocument();
    expect(screen.getByText('Board Pack')).toBeInTheDocument();
  });

  it('viewer sees only non-admin report cards (no cost or staff register)', async () => {
    renderViewer();
    await waitFor(() =>
      expect(screen.getByText('PDF Reports')).toBeInTheDocument()
    );
    expect(screen.getByText('Weekly Roster')).toBeInTheDocument();
    expect(screen.getByText('Coverage & Escalation')).toBeInTheDocument();
    // Admin-only reports should not appear for viewer
    expect(screen.queryByText('Monthly Cost Report')).not.toBeInTheDocument();
    expect(screen.queryByText('Staff Register')).not.toBeInTheDocument();
    expect(screen.queryByText('Board Pack')).not.toBeInTheDocument();
  });

  it('each visible report card has a Download PDF button', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('PDF Reports')).toBeInTheDocument()
    );
    const downloadBtns = screen.getAllByRole('button', { name: 'Download PDF' });
    // Admin sees 5 reports, each with its own button
    expect(downloadBtns).toHaveLength(5);
  });

  it('date range input is shown for roster and coverage reports', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('PDF Reports')).toBeInTheDocument()
    );
    // "Week starting (Monday)" label appears for both Weekly Roster and Coverage reports
    const weekLabels = screen.getAllByText('Week starting (Monday)');
    expect(weekLabels.length).toBe(2);
  });

  it('month input is shown for cost report', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('PDF Reports')).toBeInTheDocument()
    );
    expect(screen.getByText('Month')).toBeInTheDocument();
    // month input type
    const monthInput = document.querySelector('input[type="month"]');
    expect(monthInput).toBeTruthy();
  });

  it('clicking Download PDF for roster calls generateRosterPDF', async () => {
    const user = userEvent.setup();
    const { generateRosterPDF } = await import('../../lib/pdfReports.js');

    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('PDF Reports')).toBeInTheDocument()
    );

    // The first "Download PDF" button corresponds to the Weekly Roster card
    const downloadBtns = screen.getAllByRole('button', { name: 'Download PDF' });
    await user.click(downloadBtns[0]);

    await waitFor(() =>
      expect(generateRosterPDF).toHaveBeenCalledOnce()
    );
  });

  it('shows Report Notes section with guidance bullets', async () => {
    renderAdmin();
    await waitFor(() =>
      expect(screen.getByText('PDF Reports')).toBeInTheDocument()
    );
    expect(screen.getByText('Report Notes')).toBeInTheDocument();
    expect(screen.getByText(/Roster reports include shift colour coding/)).toBeInTheDocument();
    expect(screen.getByText(/Cost reports include budget comparison/)).toBeInTheDocument();
  });
});
