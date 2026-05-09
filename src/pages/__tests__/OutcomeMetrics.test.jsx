import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { useData } from '../../contexts/DataContext.jsx';
import OutcomeMetrics from '../OutcomeMetrics.jsx';

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));

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
    getOutcomeDashboard: vi.fn(),
    upsertOutcomeMetric: vi.fn(),
    updateOutcomeMetric: vi.fn(),
    deleteOutcomeMetric: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

function dashboardPayload(manual = []) {
  return {
    generated_at: '2026-05-08T00:00:00.000Z',
    derived: {
      incidents: { incidents_total: 2, falls: 1, infections: 0, pressure_sores: 0 },
      complaints: { complaints_total: 1 },
      trends: {
        incidents: {
          by_category: [{ label: 'Fall', count: 1 }],
          recurrence: [],
          overdue: { investigation_overdue: 0, cqc_notifiable_pending: 0 },
        },
        complaints: {
          by_category: [{ label: 'Communication', count: 1 }],
          recurrence: [],
          overdue: { acknowledgement_overdue: 0, response_overdue: 0 },
        },
      },
    },
    manual,
  };
}

describe('OutcomeMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    useData.mockReturnValue({
      activeHome: 'test-home',
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'home_manager',
      staffId: null,
    });
    api.getOutcomeDashboard.mockResolvedValue(dashboardPayload());
  });

  it('shows a no-home state without calling the outcomes API', async () => {
    useData.mockReturnValue({
      activeHome: '',
      canRead: () => true,
      canWrite: () => true,
      homeRole: 'home_manager',
      staffId: null,
    });

    renderWithProviders(<OutcomeMetrics />);

    expect(await screen.findByText('No home selected')).toBeInTheDocument();
    expect(screen.getByText('Select a home before opening outcome metrics.')).toBeInTheDocument();
    expect(api.getOutcomeDashboard).not.toHaveBeenCalled();
  });

  it('creates a manual metric with labelled fields and non-negative values', async () => {
    const user = userEvent.setup();
    api.upsertOutcomeMetric.mockResolvedValue({ id: 17, version: 1 });

    renderWithProviders(<OutcomeMetrics />);

    await screen.findByText('No manual metrics');
    await user.click(screen.getByRole('button', { name: 'New Metric' }));
    await user.selectOptions(screen.getByLabelText('Metric'), 'pressure_sores_new');
    await user.clear(screen.getByLabelText('Period start'));
    await user.type(screen.getByLabelText('Period start'), '2026-05-01');
    await user.clear(screen.getByLabelText('Period end'));
    await user.type(screen.getByLabelText('Period end'), '2026-05-31');
    await user.type(screen.getByLabelText('Numerator'), '1');
    await user.type(screen.getByLabelText('Denominator'), '42');
    await user.type(screen.getByLabelText('Notes'), 'Monthly governance review. ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(api.upsertOutcomeMetric).toHaveBeenCalledWith('test-home', expect.objectContaining({
        metric_key: 'pressure_sores_new',
        period_start: '2026-05-01',
        period_end: '2026-05-31',
        numerator: 1,
        denominator: 42,
        notes: 'Monthly governance review.',
      }));
    });
  });

  it('passes the record version when deleting a manual metric', async () => {
    const user = userEvent.setup();
    api.getOutcomeDashboard.mockResolvedValue(dashboardPayload([
      {
        id: 44,
        metric_key: 'staff_turnover_pct',
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        numerator: 2,
        denominator: 40,
        notes: 'April review',
        recorded_at: '2026-05-01T00:00:00.000Z',
        version: 5,
      },
    ]));
    api.deleteOutcomeMetric.mockResolvedValue({ ok: true });

    renderWithProviders(<OutcomeMetrics />);

    await user.click(await screen.findByRole('button', { name: 'Staff Turnover Pct' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(api.deleteOutcomeMetric).toHaveBeenCalledWith('test-home', 44, 5);
    });
  });
});
