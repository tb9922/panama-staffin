import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import OnboardingDocsTracker from '../OnboardingDocsTracker.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getOnboardingDocs: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

beforeEach(() => {
  api.getOnboardingDocs.mockResolvedValue({
    summary: {
      total_documents: 1,
      staff_with_docs: 1,
      outstanding_required_sections: 1,
    },
    byStaff: [
      {
        staff_id: 'S001',
        staff_name: 'Alice Smith',
        role: 'Carer',
        attachment_count: 1,
        sections: [
          { section: 'dbs_check', missing_required_document: false },
          { section: 'right_to_work', missing_required_document: true },
        ],
      },
    ],
    bySection: [
      { section: 'dbs_check', attachment_count: 1, missing_required_count: 0 },
      { section: 'right_to_work', attachment_count: 0, missing_required_count: 1 },
    ],
    outstandingMandatory: [
      { staff_id: 'S001', staff_name: 'Alice Smith', section: 'right_to_work', status: 'in_progress' },
    ],
  });
});

describe('OnboardingDocsTracker', () => {
  it('renders document coverage using staff-friendly section and status labels', async () => {
    renderWithProviders(<OnboardingDocsTracker />, {
      user: { username: 'admin', role: 'admin' },
      homeRole: 'home_manager',
    });

    await waitFor(() => {
      expect(screen.getByText('Onboarding Docs Center')).toBeInTheDocument();
    });
    expect(screen.getByText('Enhanced DBS Check')).toBeInTheDocument();
    expect(screen.getAllByText('Right to Work').length).toBeGreaterThan(0);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.queryByText('dbs_check')).not.toBeInTheDocument();
    expect(screen.queryByText('in_progress')).not.toBeInTheDocument();
  });
});
