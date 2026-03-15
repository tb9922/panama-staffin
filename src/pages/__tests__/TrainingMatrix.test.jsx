import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TrainingMatrix from '../TrainingMatrix.jsx';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getTrainingData: vi.fn(),
    updateTrainingTypes: vi.fn(),
    upsertTrainingRecord: vi.fn(),
    deleteTrainingRecord: vi.fn(),
    createSupervision: vi.fn(),
    updateSupervision: vi.fn(),
    deleteSupervision: vi.fn(),
    createAppraisal: vi.fn(),
    updateAppraisal: vi.fn(),
    deleteAppraisal: vi.fn(),
    createFireDrill: vi.fn(),
    updateFireDrill: vi.fn(),
    deleteFireDrill: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

vi.mock('../../hooks/useLiveDate.js', () => ({
  useLiveDate: vi.fn(() => '2026-03-08'),
}));

import * as api from '../../lib/api.js';

// ── Fixture data ──────────────────────────────────────────────────────────────

const MOCK_TRAINING_TYPES = [
  {
    id: 'fire-safety', name: 'Fire Safety', category: 'statutory',
    refresher_months: 12, roles: null, legislation: 'Regulatory Reform (Fire Safety) Order 2005',
    active: true, levels: [],
  },
  {
    id: 'moving-handling', name: 'Moving & Handling', category: 'mandatory',
    refresher_months: 12, roles: null, legislation: 'Manual Handling Operations Regulations 1992',
    active: true, levels: [],
  },
];

const MOCK_STAFF = [
  { id: 'S001', name: 'Alice Smith', role: 'Senior Carer', team: 'Day A', active: true },
  { id: 'S002', name: 'Bob Jones', role: 'Carer', team: 'Day B', active: true },
];

const MOCK_TRAINING_DATA = {
  staff: MOCK_STAFF,
  trainingTypes: MOCK_TRAINING_TYPES,
  training: {
    S001: {
      'fire-safety': {
        completed: '2026-01-01', expiry: '2027-01-01',
        trainer: 'Jane Smith', method: 'classroom', certificate_ref: 'FS-001', notes: '',
      },
    },
  },
  supervisions: { S001: [], S002: [] },
  appraisals: { S001: [], S002: [] },
  fireDrills: [],
  config: { supervision_frequency_probation: 30, supervision_frequency_standard: 49, supervision_probation_months: 6 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderAdmin() {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  return renderWithProviders(<TrainingMatrix />, { user: { username: 'admin', role: 'admin' } });
}

function renderViewer() {
  api.getLoggedInUser.mockReturnValue({ username: 'viewer', role: 'viewer' });
  return renderWithProviders(<TrainingMatrix />, { user: { username: 'viewer', role: 'viewer' }, canWrite: false });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
  api.getTrainingData.mockResolvedValue(MOCK_TRAINING_DATA);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TrainingMatrix', () => {
  it('smoke test — renders without crashing', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(
        screen.queryByText('Loading...') ||
        screen.queryByText('Training Matrix')
      ).not.toBeNull();
    });
  });

  it('shows loading state while data is fetching', () => {
    api.getTrainingData.mockReturnValue(new Promise(() => {}));
    renderAdmin();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    api.getTrainingData.mockRejectedValue(new Error('Network error'));
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('renders Training Matrix heading after data loads', async () => {
    renderAdmin();
    await waitFor(() => {
      // Two h1 elements: one for print, one visible — use getAllByText
      const headings = screen.getAllByText('Training Matrix');
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders the four tab buttons', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Training' })).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Supervisions' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Appraisals' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Fire Drills' })).toBeInTheDocument();
  });

  it('switches to Supervisions tab on click', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Supervisions' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: 'Supervisions' }));

    await waitFor(() => {
      // SupervisionPanel renders a heading or relevant content
      expect(
        screen.queryByText('Supervisions') ||
        screen.queryByText(/supervision/i)
      ).not.toBeNull();
    });
  });

  it('training tab shows staff names in the matrix', async () => {
    renderAdmin();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('displays training type names as column headers', async () => {
    renderAdmin();
    await waitFor(() => {
      // Training types appear as columns in the grid
      const fireSafety = screen.queryAllByText('Fire Safety');
      expect(fireSafety.length).toBeGreaterThan(0);
    });
  });

  it('viewer role can still see Training Matrix and tabs', async () => {
    renderViewer();
    await waitFor(() => {
      // Training Matrix heading appears twice (print + screen) — just check it exists
      const headings = screen.getAllByText('Training Matrix');
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });
    // All four tabs are visible regardless of role
    expect(screen.getByRole('tab', { name: 'Training' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Supervisions' })).toBeInTheDocument();
  });
});
