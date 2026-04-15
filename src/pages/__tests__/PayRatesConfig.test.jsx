import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import PayRatesConfig from '../PayRatesConfig.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getPayRateRules: vi.fn(),
    createPayRateRule: vi.fn(),
    updatePayRateRule: vi.fn(),
    deletePayRateRule: vi.fn(),
    getNMWRates: vi.fn(),
    getRecordAttachments: vi.fn(),
    uploadRecordAttachment: vi.fn(),
    deleteRecordAttachment: vi.fn(),
    downloadRecordAttachment: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../hooks/useDirtyGuard', () => ({
  default: vi.fn(),
}));

import * as api from '../../lib/api.js';

const MOCK_RULES = [
  {
    id: 'rule-1', name: 'Night Enhancement', rate_type: 'percentage',
    amount: '15', applies_to: 'night', priority: 0, effective_from: '2026-01-01',
  },
  {
    id: 'rule-2', name: 'Sunday Premium', rate_type: 'fixed_hourly',
    amount: '2.50', applies_to: 'weekend_sun', priority: 0, effective_from: '2026-01-01',
  },
];

const MOCK_NMW_RATES = [
  { id: 'nmw-1', age_bracket: '21+', effective_from: '2025-04-01', hourly_rate: '12.21' },
  { id: 'nmw-2', age_bracket: '18-20', effective_from: '2025-04-01', hourly_rate: '10.00' },
];

function setupMocks(rules = MOCK_RULES, nmwRates = MOCK_NMW_RATES) {
  api.getPayRateRules.mockResolvedValue(rules);
  api.getNMWRates.mockResolvedValue(nmwRates);
  api.getRecordAttachments.mockResolvedValue([]);
}

describe('PayRatesConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.getCurrentHome.mockReturnValue('test-home');
  });

  it('smoke test - renders without crashing', async () => {
    setupMocks();
    renderWithProviders(<PayRatesConfig />);
    await waitFor(() =>
      expect(screen.getByText('Pay Rate Rules')).toBeInTheDocument()
    );
  });

  it('shows loading state initially', () => {
    api.getPayRateRules.mockReturnValue(new Promise(() => {}));
    api.getNMWRates.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<PayRatesConfig />);
    expect(screen.getByText(/Loading rules/)).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getPayRateRules.mockRejectedValue(new Error('Server error'));
    api.getNMWRates.mockResolvedValue([]);
    renderWithProviders(<PayRatesConfig />);
    await waitFor(() =>
      expect(screen.getByText('Server error')).toBeInTheDocument()
    );
  });

  it('renders enhancement rules table with correct data', async () => {
    setupMocks();
    renderWithProviders(<PayRatesConfig />);
    await waitFor(() =>
      expect(screen.getByText('Night Enhancement')).toBeInTheDocument()
    );
    expect(screen.getByText('Sunday Premium')).toBeInTheDocument();
    expect(screen.getByText('Night Shifts')).toBeInTheDocument();
    expect(screen.getByText('Sunday')).toBeInTheDocument();
    expect(screen.getByText('15%')).toBeInTheDocument();
    expect(screen.getByText('+\u00A32.50/hr')).toBeInTheDocument();
  });

  it('renders NMW reference table', async () => {
    setupMocks();
    renderWithProviders(<PayRatesConfig />);
    await waitFor(() =>
      expect(screen.getByText('National Minimum Wage Reference')).toBeInTheDocument()
    );
    expect(screen.getByText('21+')).toBeInTheDocument();
    expect(screen.getByText('18-20')).toBeInTheDocument();
    expect(screen.getByText('\u00A312.21/hr')).toBeInTheDocument();
  });

  it('admin sees "+ Add Rule", "Edit", and "Remove" buttons', async () => {
    setupMocks();
    renderWithProviders(<PayRatesConfig />);
    await waitFor(() =>
      expect(screen.getByText('Night Enhancement')).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: '+ Add Rule' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: 'Remove' }).length).toBe(2);
  });

  it('viewer does not see "+ Add Rule", "Edit", or "Remove" buttons', async () => {
    api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
    setupMocks();
    renderWithProviders(<PayRatesConfig />, { user: { username: 'viewer', role: 'viewer' }, canWrite: false });
    await waitFor(() =>
      expect(screen.getByText('Night Enhancement')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: '+ Add Rule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('opens Add Rule modal when admin clicks + Add Rule', async () => {
    const user = userEvent.setup();
    setupMocks();
    renderWithProviders(<PayRatesConfig />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Add Rule' })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: '+ Add Rule' }));
    // Modal dialog should appear with the form title
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Add Pay Rate Rule')).toBeInTheDocument();
    // "Rule Name", "Applies To", "Rate Type" appear in both table headers and modal labels,
    // so use getAllByText to verify they're present (table header + modal label = 2 each)
    expect(screen.getAllByText('Rule Name').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Applies To').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Rate Type').length).toBeGreaterThanOrEqual(2);
  });

  it('lets admins save a rule with amount 0', async () => {
    const user = userEvent.setup();
    setupMocks();
    api.createPayRateRule.mockResolvedValue({ id: 'rule-3' });
    renderWithProviders(<PayRatesConfig />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Add Rule' })).toBeInTheDocument()
    );

    await user.click(screen.getByRole('button', { name: '+ Add Rule' }));
    await user.type(screen.getByLabelText('Rule Name'), 'Zero uplift');
    await user.clear(screen.getByLabelText('Amount (%)'));
    await user.type(screen.getByLabelText('Amount (%)'), '0');
    await user.click(screen.getByRole('button', { name: 'Add Rule' }));

    await waitFor(() =>
      expect(api.createPayRateRule).toHaveBeenCalledWith('test-home', expect.objectContaining({
        name: 'Zero uplift',
        amount: 0,
      }))
    );
  });
});
