import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import DpiaManager from '../DpiaManager.jsx';

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
    getDpiaAssessments: vi.fn(),
    createDpiaAssessment: vi.fn(),
    updateDpiaAssessment: vi.fn(),
    deleteDpiaAssessment: vi.fn(),
    getRecordAttachments: vi.fn(),
    uploadRecordAttachment: vi.fn(),
    deleteRecordAttachment: vi.fn(),
    downloadRecordAttachment: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

const MOCK_ROWS = [
  {
    id: 1,
    title: 'Resident wearable sensors',
    processing_description: 'Collect fall-risk telemetry',
    screening_result: 'required',
    risk_level: 'high',
    status: 'screening',
    version: 3,
  },
];

function renderAdmin() {
  return renderWithProviders(<DpiaManager />, {
    user: { username: 'admin', role: 'admin' },
  });
}

describe('DpiaManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    api.getDpiaAssessments.mockResolvedValue({ rows: MOCK_ROWS, total: MOCK_ROWS.length });
    api.createDpiaAssessment.mockResolvedValue({ id: 2 });
    api.updateDpiaAssessment.mockResolvedValue({ id: 1 });
    api.deleteDpiaAssessment.mockResolvedValue({ ok: true });
    api.getRecordAttachments.mockResolvedValue([]);
  });

  it('loads and renders assessment rows', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Resident wearable sensors')).toBeInTheDocument());
    expect(screen.getByText('DPIA Required')).toBeInTheDocument();
    expect(screen.getAllByText('Screening').length).toBeGreaterThan(0);
  });

  it('shows empty state when there are no assessments', async () => {
    api.getDpiaAssessments.mockResolvedValue({ rows: [], total: 0 });
    renderAdmin();
    await waitFor(() => expect(screen.getByText('No DPIAs recorded')).toBeInTheDocument());
  });

  it('shows an error state when load fails', async () => {
    api.getDpiaAssessments.mockRejectedValue(new Error('DPIA API down'));
    renderAdmin();
    await waitFor(() => expect(screen.getByText('DPIA API down')).toBeInTheDocument());
  });

  it('creates a new DPIA from the modal', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Resident wearable sensors')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /\+ new dpia/i }));
    await user.type(screen.getByLabelText(/title/i), 'Bodycam rollout');
    await user.type(screen.getByLabelText(/processing description/i), 'Assess bodycam footage handling');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(api.createDpiaAssessment).toHaveBeenCalledWith('test-home', expect.objectContaining({
        title: 'Bodycam rollout',
        processing_description: 'Assess bodycam footage handling',
      }));
    });
    expect(api.getDpiaAssessments).toHaveBeenCalledTimes(2);
  });

  it('edits an existing DPIA', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Resident wearable sensors')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /edit/i }));
    const titleInput = screen.getByLabelText(/title/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Resident wearable sensors - phase 2');
    await user.click(screen.getByRole('button', { name: /^update$/i }));

    await waitFor(() => {
      expect(api.updateDpiaAssessment).toHaveBeenCalledWith(
        'test-home',
        1,
        expect.objectContaining({
          title: 'Resident wearable sensors - phase 2',
          _version: 3,
        })
      );
    });
  });

  it('archives an existing DPIA', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Resident wearable sensors')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /archive/i }));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalled();
      expect(api.deleteDpiaAssessment).toHaveBeenCalledWith('test-home', 1);
    });
  });
});
