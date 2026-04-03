import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import CoverageAlertBanner from '../CoverageAlertBanner.jsx';

// ── Module mocks ──────────────────────────────────────────────────────────────

let mockActiveHome = 'test-home';

vi.mock('../../contexts/DataContext.jsx', () => ({
  useData: vi.fn(() => ({ activeHome: mockActiveHome })),
}));

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => mockActiveHome),
    getSchedulingData: vi.fn(),
  };
});

vi.mock('../../hooks/useLiveDate.js', () => ({
  useLiveDate: vi.fn(() => '2026-03-08'),
}));

import * as api from '../../lib/api.js';
import { useData } from '../../contexts/DataContext.jsx';

// ── Fixture helpers ───────────────────────────────────────────────────────────

/**
 * Build minimal scheduling data that produces a given escalation level.
 *
 * - level < 3 (covered / float / OT): no banner
 * - level 3 (agency):    banner shown as ALERT
 * - level 4 (short):     banner shown as CRITICAL
 * - level 5 (unsafe):    banner shown as CRITICAL / UNSAFE
 *
 * Easiest approach: supply mock data and let the real rotation/escalation
 * engine compute the coverage.  We use a config with minimums of 0 for
 * "covered" scenarios and high minimums for "short" scenarios.
 */
function makeSchedulingData({ minimumHeads = 0, staff = [], overrides = {} } = {}) {
  return {
    config: {
      home_name: 'Test Home',
      cycle_start_date: '2025-01-06',
      shifts: {
        E:  { start: '07:00', end: '15:00', hours: 8 },
        L:  { start: '14:00', end: '22:00', hours: 8 },
        EL: { start: '07:00', end: '19:00', hours: 12 },
        N:  { start: '21:00', end: '07:00', hours: 10 },
      },
      minimum_staffing: {
        early: { heads: minimumHeads, skill_points: 0 },
        late:  { heads: minimumHeads, skill_points: 0 },
        night: { heads: minimumHeads, skill_points: 0 },
      },
      bank_holidays: [],
      agency_rate_day: 25,
      agency_rate_night: 30,
      ot_premium: 2,
      bh_premium_multiplier: 2,
    },
    staff,
    overrides,
  };
}

// A single active Senior Carer on Day A — will be scheduled EL on their working days
const STAFF_ALICE = {
  id: 'S001', name: 'Alice Smith', role: 'Senior Carer', team: 'Day A',
  pref: 'EL', skill: 1.5, hourly_rate: 14.50, active: true,
  start_date: '2020-01-01', contract_hours: 36, wtr_opt_out: false,
};

// ── Render helper ─────────────────────────────────────────────────────────────

function renderBanner() {
  // CoverageAlertBanner uses useNavigate — needs router context
  const router = createMemoryRouter(
    [{ path: '*', element: <CoverageAlertBanner /> }],
    { initialEntries: ['/'] },
  );
  return render(<RouterProvider router={router} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CoverageAlertBanner', () => {
  beforeEach(() => {
    mockActiveHome = 'test-home';
    api.getCurrentHome.mockReturnValue('test-home');
    useData.mockReturnValue({ activeHome: 'test-home' });
  });

  it('smoke test — renders without crashing', () => {
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    expect(() => renderBanner()).not.toThrow();
  });

  it('renders nothing when coverage is fully satisfied (minimums = 0)', async () => {
    // minimums = 0 → overallLevel = 0 (LVL0 Normal) → banner hidden
    api.getSchedulingData.mockResolvedValue(makeSchedulingData({ minimumHeads: 0 }));
    renderBanner();

    // Wait for async data load to complete
    await waitFor(() => {
      expect(api.getSchedulingData).toHaveBeenCalledWith('test-home', expect.objectContaining({
        signal: expect.any(AbortSignal),
      }));
    });

    // Banner should not be in the document
    expect(screen.queryByText(/ALERT/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/CRITICAL/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/coverage is at/i)).not.toBeInTheDocument();
  });

  it('renders nothing when data has not loaded yet', () => {
    // Keep promise pending — data = null → banner returns null
    api.getSchedulingData.mockReturnValue(new Promise(() => {}));
    renderBanner();
    expect(screen.queryByText(/ALERT/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/CRITICAL/i)).not.toBeInTheDocument();
  });

  it('shows CRITICAL banner when coverage is well below minimum (SHORT-STAFFED)', async () => {
    // minimum = 99 heads with zero staff → LVL5 UNSAFE → isCritical = true
    api.getSchedulingData.mockResolvedValue(
      makeSchedulingData({ minimumHeads: 99, staff: [] }),
    );
    renderBanner();

    await waitFor(() => {
      expect(screen.getByText(/CRITICAL/i)).toBeInTheDocument();
    });
    // "coverage is at" phrase in the banner
    expect(screen.getByText(/coverage is at/i)).toBeInTheDocument();
  });

  it('shows a View Details link that is present in the critical banner', async () => {
    api.getSchedulingData.mockResolvedValue(
      makeSchedulingData({ minimumHeads: 99, staff: [] }),
    );
    renderBanner();

    await waitFor(() => {
      expect(screen.getByText(/CRITICAL/i)).toBeInTheDocument();
    });

    const viewDetails = screen.getByRole('button', { name: /View Details/i });
    expect(viewDetails).toBeInTheDocument();
  });

  it('fetches data for the current home from context', async () => {
    mockActiveHome = 'oakwood';
    api.getCurrentHome.mockReturnValue('oakwood');
    useData.mockReturnValue({ activeHome: 'oakwood' });
    api.getSchedulingData.mockResolvedValue(makeSchedulingData({ minimumHeads: 0 }));

    renderBanner();

    await waitFor(() => {
      expect(api.getSchedulingData).toHaveBeenCalledWith('oakwood', expect.objectContaining({
        signal: expect.any(AbortSignal),
      }));
    });
  });

  it('does not warn when the scheduling request is aborted during teardown', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.getSchedulingData.mockImplementation((_home, options = {}) => new Promise((_, reject) => {
      options.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
    }));

    const { unmount } = renderBanner();
    unmount();
    await Promise.resolve();

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
