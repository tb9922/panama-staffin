import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { useData } from '../../contexts/DataContext.jsx';
import ScanInbox from '../ScanInbox.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    listScanIntake: vi.fn(),
    getScanIntakeItem: vi.fn(),
    createScanIntake: vi.fn(),
    confirmScanIntake: vi.fn(),
    rejectScanIntake: vi.fn(),
    retryScanIntake: vi.fn(),
    getMaintenance: vi.fn().mockResolvedValue({ checks: [] }),
    getFinanceExpenses: vi.fn().mockResolvedValue({ rows: [] }),
    getPaymentSchedules: vi.fn().mockResolvedValue({ rows: [] }),
    getOnboardingData: vi.fn().mockResolvedValue({ onboarding: {}, staff: [] }),
    getCqcEvidence: vi.fn().mockResolvedValue({ evidence: [] }),
    getSuppliers: vi.fn().mockResolvedValue([]),
  };
});

import * as api from '../../lib/api.js';

describe('ScanInbox contextual launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listScanIntake.mockResolvedValue({
      rows: [{
        id: 7,
        original_name: 'incident-note.pdf',
        classification_target: null,
        classification_confidence: null,
        status: 'ready_for_review',
        created_at: '2026-04-15T10:00:00Z',
      }],
      total: 1,
    });
    api.getScanIntakeItem.mockResolvedValue({
      id: 7,
      original_name: 'incident-note.pdf',
      status: 'ready_for_review',
      classification_target: null,
      summary_fields: { fields: {}, confidences: {}, classification: {} },
    });
  });

  it('prefills contextual record-attachment launches', async () => {
    renderWithProviders(<ScanInbox />, {
      route: '/scan-inbox?launchTarget=record_attachment&moduleId=incident&recordId=INC-42&returnTo=%2Fincidents',
      path: '/scan-inbox',
    });

    await waitFor(() => expect(screen.getAllByText('incident-note.pdf').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByLabelText('Destination')).toBeInTheDocument());
    expect(screen.getByText(/Scans from this session will default to/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Destination')).toHaveValue('record_attachment');
    expect(screen.getAllByText('Incident INC-42').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Back to previous page' })).toHaveAttribute('href', '/incidents');
  });

  it('prefills handover launch fields from the scan link context', async () => {
    renderWithProviders(<ScanInbox />, {
      route: '/scan-inbox?launchTarget=handover&entryDate=2026-04-16&shift=L&category=operational&priority=action',
      path: '/scan-inbox',
    });

    await waitFor(() => expect(screen.getAllByText('incident-note.pdf').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByLabelText('Destination')).toHaveValue('handover'));
    expect(screen.getByDisplayValue('2026-04-16')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Late Shift', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Operational', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Action required', selected: true })).toBeInTheDocument();
  });

  it('prefills the CQC statement when launched from a statement-level scan CTA', async () => {
    renderWithProviders(<ScanInbox />, {
      route: '/scan-inbox?launchTarget=cqc&qualityStatement=S4',
      path: '/scan-inbox',
    });

    await waitFor(() => expect(screen.getAllByText('incident-note.pdf').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByLabelText('Destination')).toHaveValue('cqc'));
    expect(screen.getByDisplayValue('S4')).toBeInTheDocument();
  });

  it('does not call scan APIs when scan intake is disabled for the home', async () => {
    useData.mockReturnValue({
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'home_manager',
      staffId: null,
      scanIntakeEnabled: false,
      scanIntakeTargets: [],
      isScanTargetEnabled: () => false,
    });

    renderWithProviders(<ScanInbox />, { route: '/scan-inbox', path: '/scan-inbox' });

    expect(screen.getByText('Scan intake is disabled')).toBeInTheDocument();
    await waitFor(() => expect(api.listScanIntake).not.toHaveBeenCalled());
    expect(api.getMaintenance).not.toHaveBeenCalled();
    expect(api.getFinanceExpenses).not.toHaveBeenCalled();
    expect(api.getCqcEvidence).not.toHaveBeenCalled();
  });
});
