import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import RopaManager from '../RopaManager.jsx';

const confirmMock = vi.fn();

vi.mock('../../hooks/useConfirm.jsx', () => ({
  useConfirm: () => ({
    confirm: confirmMock,
    ConfirmDialog: null,
  }),
}));

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getRopaActivities: vi.fn(),
    createRopaActivity: vi.fn(),
    updateRopaActivity: vi.fn(),
    deleteRopaActivity: vi.fn(),
    getRecordAttachments: vi.fn(),
    uploadRecordAttachment: vi.fn(),
    deleteRecordAttachment: vi.fn(),
    downloadRecordAttachment: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

const MOCK_ROWS = [
  {
    id: 11,
    purpose: 'Payroll processing',
    legal_basis: 'legal_obligation',
    categories_of_individuals: 'Staff',
    categories_of_data: 'Payroll and tax data',
    special_category: false,
    dpia_required: false,
    status: 'active',
    version: 4,
  },
];

function renderAdmin() {
  return renderWithProviders(<RopaManager />, {
    user: { username: 'admin', role: 'admin' },
  });
}

describe('RopaManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    api.getRopaActivities.mockResolvedValue({ rows: MOCK_ROWS, total: MOCK_ROWS.length });
    api.createRopaActivity.mockResolvedValue({ id: 12 });
    api.updateRopaActivity.mockResolvedValue({ id: 11 });
    api.deleteRopaActivity.mockResolvedValue({ ok: true });
    api.getRecordAttachments.mockResolvedValue([]);
  });

  it('loads and renders activity rows', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Payroll processing')).toBeInTheDocument());
    expect(screen.getByText('Staff')).toBeInTheDocument();
    expect(screen.getByText('Payroll and tax data')).toBeInTheDocument();
  });

  it('shows empty state when there are no activities', async () => {
    api.getRopaActivities.mockResolvedValue({ rows: [], total: 0 });
    renderAdmin();
    await waitFor(() => expect(screen.getByText('No processing activities recorded')).toBeInTheDocument());
  });

  it('shows an error state when load fails', async () => {
    api.getRopaActivities.mockRejectedValue(new Error('ROPA API down'));
    renderAdmin();
    await waitFor(() => expect(screen.getByText('ROPA API down')).toBeInTheDocument());
  });

  it('creates a new processing activity', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Payroll processing')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /\+ add activity/i }));
    await user.type(screen.getByPlaceholderText(/staff payroll processing/i), 'Resident admissions');
    await user.type(screen.getByPlaceholderText(/staff, residents, next-of-kin/i), 'Residents');
    await user.type(screen.getByPlaceholderText(/contact, health, financial/i), 'Demographics');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(api.createRopaActivity).toHaveBeenCalledWith('test-home', expect.objectContaining({
        purpose: 'Resident admissions',
        categories_of_individuals: 'Residents',
        categories_of_data: 'Demographics',
      }));
    });
  });

  it('edits an existing activity', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Payroll processing')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /edit/i }));
    const purposeInput = screen.getByDisplayValue('Payroll processing');
    await user.clear(purposeInput);
    await user.type(purposeInput, 'Payroll processing and pensions');
    await user.click(screen.getByRole('button', { name: /^update$/i }));

    await waitFor(() => {
      expect(api.updateRopaActivity).toHaveBeenCalledWith(
        'test-home',
        11,
        expect.objectContaining({
          purpose: 'Payroll processing and pensions',
          _version: 4,
        })
      );
    });
  });

  it('archives an activity', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Payroll processing')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /archive/i }));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalled();
      expect(api.deleteRopaActivity).toHaveBeenCalledWith('test-home', 11);
    });
  });
});
