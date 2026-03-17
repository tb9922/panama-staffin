import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { MOCK_SCHEDULING_DATA, MOCK_CONFIG, MOCK_STAFF } from '../../test/fixtures/schedulingData.js';
import Config from '../Config.jsx';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/api.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getSchedulingData: vi.fn(),
    saveConfig: vi.fn(),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getPayRateConsistency: vi.fn(),
  };
});

vi.mock('../../lib/bankHolidays.js', () => ({
  syncBankHolidays: vi.fn(),
}));

vi.mock('../../lib/rotation.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    isCareRole: actual.isCareRole,
  };
});

vi.mock('../../lib/design.js', async (importActual) => {
  const actual = await importActual();
  return actual;
});

// shared/nmw.js is a real module — let it resolve naturally via actual import

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { getSchedulingData, saveConfig, getLoggedInUser, getPayRateConsistency } from '../../lib/api.js';

function setupAdminMocks(consistency = { consistent: true, warnings: [] }) {
  getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  getSchedulingData.mockResolvedValue({ ...MOCK_SCHEDULING_DATA });
  saveConfig.mockResolvedValue({});
  getPayRateConsistency.mockResolvedValue(consistency);
}

function setupViewerMocks() {
  getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  getSchedulingData.mockResolvedValue({ ...MOCK_SCHEDULING_DATA });
  getPayRateConsistency.mockResolvedValue({ consistent: true, warnings: [] });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAdminMocks();
  });

  it('smoke test — renders without crashing', async () => {
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());
  });

  it('shows loading state while data is being fetched', () => {
    // Never-resolving promise keeps the loading state
    getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<Config />);
    expect(screen.getByText('Loading settings...')).toBeInTheDocument();
  });

  it('displays Home Details section', async () => {
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    expect(screen.getByText('Home Details')).toBeInTheDocument();
  });

  it('displays Shift Times & Hours section', async () => {
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    expect(screen.getByText('Shift Times & Hours')).toBeInTheDocument();
  });

  it('displays Minimum Staffing Levels section', async () => {
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    expect(screen.getByText('Minimum Staffing Levels')).toBeInTheDocument();
  });

  it('displays Overtime & Agency section', async () => {
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    expect(screen.getByText('Overtime & Agency')).toBeInTheDocument();
  });

  it('displays Safety Limits section', async () => {
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    expect(screen.getByText('Safety Limits')).toBeInTheDocument();
  });

  it('displays Annual Leave section', async () => {
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    expect(screen.getByText('Annual Leave')).toBeInTheDocument();
  });

  it('displays Bank Holiday & Sickness section', async () => {
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    expect(screen.getByText('Bank Holiday & Sickness')).toBeInTheDocument();
  });

  it('displays Bank Holidays section', async () => {
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    expect(screen.getByText('Bank Holidays')).toBeInTheDocument();
  });

  it('admin sees Save Changes button', async () => {
    setupAdminMocks();
    renderWithProviders(<Config />, { user: { username: 'admin', role: 'admin' } });
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument();
  });

  it('viewer does NOT see Save Changes button', async () => {
    setupViewerMocks();
    renderWithProviders(<Config />, { user: { username: 'viewer', role: 'viewer' }, canWrite: false });
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /Save Changes/i })).not.toBeInTheDocument();
  });

  it('admin sees Save UK Bank Holidays sync button', async () => {
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /Sync UK Bank Holidays/i })).toBeInTheDocument();
  });

  it('shows current leave year date range under Leave Year Start selector', async () => {
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    // The inline IIFE renders "Current: <date> – <date>"
    expect(screen.getByText(/Current:/)).toBeInTheDocument();
  });

  it('handles API load error — shows error message with retry button', async () => {
    getSchedulingData.mockRejectedValue(new Error('Network error loading settings'));
    renderWithProviders(<Config />);

    await waitFor(() => {
      expect(screen.getByText('Network error loading settings')).toBeInTheDocument();
    });

    // Retry button should be present
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // Main content should not show
    expect(screen.queryByText('Home Details')).not.toBeInTheDocument();
  });

  it('admin can save config — Save Changes button calls saveConfig', async () => {
    setupAdminMocks();
    const user = userEvent.setup();
    renderWithProviders(<Config />, { user: { username: 'admin', role: 'admin' } });
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(saveConfig).toHaveBeenCalledWith('test-home', expect.any(Object));
    });
  });

  it('shows Saved! text after successful save', async () => {
    setupAdminMocks();
    const user = userEvent.setup();
    renderWithProviders(<Config />, { user: { username: 'admin', role: 'admin' } });
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Saved!' })).toBeInTheDocument();
    });
  });

  it('shows unsaved changes banner when admin edits a field', async () => {
    setupAdminMocks();
    const user = userEvent.setup();
    renderWithProviders(<Config />, { user: { username: 'admin', role: 'admin' } });
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    // Edit the Home Name input
    const homeNameInput = screen.getByDisplayValue('Test Care Home');
    await user.clear(homeNameInput);
    await user.type(homeNameInput, 'New Home Name');

    await waitFor(() => {
      expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
    });
  });

  it('shows save error when saveConfig rejects', async () => {
    setupAdminMocks();
    saveConfig.mockRejectedValue(new Error('Save failed due to validation'));
    const user = userEvent.setup();
    renderWithProviders(<Config />, { user: { username: 'admin', role: 'admin' } });
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/Save failed:/)).toBeInTheDocument();
    });
  });

  it('viewer role — config fields are rendered (visible to all)', async () => {
    setupViewerMocks();
    renderWithProviders(<Config />, { user: { username: 'viewer', role: 'viewer' }, canWrite: false });
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    // Config fields visible to viewers
    expect(screen.getByText('Home Details')).toBeInTheDocument();
    expect(screen.getByText('Shift Times & Hours')).toBeInTheDocument();
  });

  it('displays shift table column headers', async () => {
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    expect(screen.getByRole('columnheader', { name: 'Code' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Hours' })).toBeInTheDocument();
  });

  it('Leave Year Start dropdown has the three options', async () => {
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    expect(screen.getByRole('option', { name: 'January (Calendar year)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'April (UK tax year)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'September (Academic year)' })).toBeInTheDocument();
  });

  it('shows the care type selector with Residential/Nursing/Dementia/Mixed options', async () => {
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

    expect(screen.getByRole('option', { name: 'Residential' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Nursing' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dementia' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Mixed' })).toBeInTheDocument();
  });

  it('shows amber banner in Overtime & Agency section when rate mismatch detected', async () => {
    const mismatch = {
      consistent: false,
      warnings: [{
        field: 'ot_premium',
        message: 'Extra Shift Premium in Pay Rate Rules is \u00A33.00/hr, but Home Settings OT Premium is \u00A32.00/hr.',
        configValue: 2, rulesValue: 3,
      }],
    };
    setupAdminMocks(mismatch);
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());
    expect(screen.getByText('Rate mismatch detected')).toBeInTheDocument();
  });

  it('does not show banner when consistency check reports no mismatch', async () => {
    setupAdminMocks({ consistent: true, warnings: [] });
    renderWithProviders(<Config />);
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());
    expect(screen.queryByText('Rate mismatch detected')).not.toBeInTheDocument();
  });
});
