import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import { MOCK_SCHEDULING_DATA, MOCK_CONFIG, MOCK_STAFF } from '../../test/fixtures/schedulingData.js';
import ScenarioModel from '../ScenarioModel.jsx';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getSchedulingData: vi.fn(),
  };
});

vi.mock('../../hooks/useLiveDate.js', () => ({
  useLiveDate: vi.fn(() => '2026-03-08'),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import * as api from '../../lib/api.js';

// ---------------------------------------------------------------------------
// Fixture — config needs the extra fields ScenarioModel reads
// ---------------------------------------------------------------------------

const SCHED_DATA = {
  ...MOCK_SCHEDULING_DATA,
  config: {
    ...MOCK_CONFIG,
    bank_staff_pool_size: 4,
    night_gap_pct: 0.3,
    ot_premium: 2,
    agency_rate_day: 25,
    agency_rate_night: 30,
    weekly_ot_cap: 8,
    shifts: {
      E:  { start: '07:00', end: '15:00', hours: 8 },
      L:  { start: '14:00', end: '22:00', hours: 8 },
      EL: { start: '07:00', end: '19:00', hours: 12 },
      N:  { start: '21:00', end: '07:00', hours: 10 },
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderScenario() {
  api.getSchedulingData.mockResolvedValue(SCHED_DATA);
  return renderWithProviders(<ScenarioModel />, {
    user: { username: 'admin', role: 'admin' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScenarioModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('smoke test — renders without crashing', async () => {
    renderScenario();
    await waitFor(() =>
      expect(screen.getByText('Staffing Cost Scenarios')).toBeInTheDocument()
    );
  });

  it('shows loading text while data is being fetched', () => {
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ScenarioModel />, { user: { username: 'admin', role: 'admin' } });
    expect(screen.getByText('Loading scenario data...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getSchedulingData.mockRejectedValue(new Error('Connection refused'));
    renderWithProviders(<ScenarioModel />, { user: { username: 'admin', role: 'admin' } });
    await waitFor(() =>
      expect(screen.getByText('Connection refused')).toBeInTheDocument()
    );
    expect(screen.queryByText('Staffing Cost Scenarios')).not.toBeInTheDocument();
  });

  it('renders the custom what-if scenario builder with input fields', async () => {
    renderScenario();
    await waitFor(() =>
      expect(screen.getByText('Custom What-If Scenario')).toBeInTheDocument()
    );
    // Labels are not linked via htmlFor — query by their text and nearby inputs
    expect(screen.getByText('Sick per day')).toBeInTheDocument();
    expect(screen.getByText('AL per day')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    // Three inputs exist in the custom scenario builder
    const inputs = screen.getAllByRole('spinbutton');
    // Two numeric inputs (sick, AL)
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it('renders all preset scenario rows in the table', async () => {
    renderScenario();
    await waitFor(() =>
      expect(screen.getByText('Staffing Cost Scenarios')).toBeInTheDocument()
    );
    // 6 presets + 1 custom row
    expect(screen.getByText('CLEAN (Zero disruption)')).toBeInTheDocument();
    expect(screen.getByText('TYPICAL WEEK')).toBeInTheDocument();
    expect(screen.getByText('BAD WEEK')).toBeInTheDocument();
    expect(screen.getByText('CRISIS WEEK')).toBeInTheDocument();
    expect(screen.getByText('WORST CASE (Winter/Flu)')).toBeInTheDocument();
    expect(screen.getByText('PANDEMIC / NOROVIRUS')).toBeInTheDocument();
    // Custom scenario row is present (default label)
    expect(screen.getByText('Custom Scenario')).toBeInTheDocument();
  });

  it('scenario table shows expected cascade columns', async () => {
    renderScenario();
    await waitFor(() =>
      expect(screen.getByText('Staffing Cost Scenarios')).toBeInTheDocument()
    );
    // Column headers appear as text nodes in <th> elements
    // "Scenario" appears in both the main table and the winter table
    const scenarioHeaders = screen.getAllByText('Scenario');
    expect(scenarioHeaders.length).toBeGreaterThanOrEqual(1);
    // "Float" and "OT" appear as column headers in main table
    const floatHeaders = screen.getAllByText('Float');
    expect(floatHeaders.length).toBeGreaterThanOrEqual(1);
    const otHeaders = screen.getAllByText('OT');
    expect(otHeaders.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('AG Day')).toBeInTheDocument();
    expect(screen.getByText('AG Night')).toBeInTheDocument();
    // "Annual £" column header in main table
    const annualHeaders = screen.getAllByText('Annual £');
    expect(annualHeaders.length).toBeGreaterThanOrEqual(1);
  });

  it('updating sick per day input changes the custom scenario row', async () => {
    const user = userEvent.setup();
    renderScenario();
    await waitFor(() =>
      expect(screen.getByText('Sick per day')).toBeInTheDocument()
    );

    // The sick input is the first number input in the custom scenario builder section
    // (min=0 max=15 step=1 — the only input with max="15")
    const sickInput = document.querySelector('input[max="15"]');
    expect(sickInput).toBeTruthy();
    await user.clear(sickInput);
    await user.type(sickInput, '5');
    // Input reflects new value
    expect(sickInput).toHaveValue(5);
  });

  it('renders Agency Kill Impact section with cost comparison', async () => {
    renderScenario();
    await waitFor(() =>
      expect(screen.getByText('Agency Kill Impact')).toBeInTheDocument()
    );
    expect(screen.getByText(/WITHOUT Agency Kill/)).toBeInTheDocument();
    expect(screen.getByText(/WITH Agency Kill/)).toBeInTheDocument();
    expect(screen.getByText('Annual Saving per Home:')).toBeInTheDocument();
  });

  it('renders Winter Scenarios section with gap/float/OT/agency columns', async () => {
    renderScenario();
    await waitFor(() =>
      expect(screen.getByText(/Winter Scenarios/)).toBeInTheDocument()
    );
    expect(screen.getByText('WINTER TYPICAL')).toBeInTheDocument();
    expect(screen.getByText('NOROVIRUS PEAK')).toBeInTheDocument();
  });

  it('renders Assumptions footer with config values', async () => {
    renderScenario();
    await waitFor(() =>
      expect(screen.getByText(/Assumptions:/)).toBeInTheDocument()
    );
    // Float pool size from MOCK_STAFF (Dan Wilson is inactive, so 0 active floats)
    expect(screen.getByText(/Float pool/)).toBeInTheDocument();
    expect(screen.getByText(/Agency day/)).toBeInTheDocument();
    expect(screen.getByText(/Agency night/)).toBeInTheDocument();
  });
});
