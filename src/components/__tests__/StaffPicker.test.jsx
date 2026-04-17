import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StaffPicker from '../StaffPicker.jsx';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getHrStaffList: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

// ── Fixture data ──────────────────────────────────────────────────────────────

const MOCK_STAFF = [
  { id: 'S001', name: 'Alice Smith', role: 'Senior Carer', active: true },
  { id: 'S002', name: 'Bob Jones', role: 'Carer', active: true },
  { id: 'S003', name: 'Carol Davis', role: 'Night Carer', active: false },
];

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  api.getHrStaffList.mockResolvedValue(MOCK_STAFF);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StaffPicker', () => {
  it('smoke test — renders a select element without crashing', () => {
    api.getHrStaffList.mockReturnValue(new Promise(() => {}));
    render(<StaffPicker value="" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders default placeholder option when showAll is not set', async () => {
    render(<StaffPicker value="" onChange={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('-- Select staff --')).toBeInTheDocument();
    });
  });

  it('renders "All Staff" placeholder option when showAll is true', async () => {
    render(<StaffPicker value="" onChange={vi.fn()} showAll />);
    await waitFor(() => {
      expect(screen.getByText('All Staff')).toBeInTheDocument();
    });
  });

  it('renders active staff options after data loads', async () => {
    render(<StaffPicker value="" onChange={vi.fn()} />);

    await waitFor(() => {
      // Alice and Bob are active — they should appear in the dropdown
      expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
      expect(screen.getByText(/Bob Jones/i)).toBeInTheDocument();
    });
  });

  it('does not show inactive staff by default', async () => {
    render(<StaffPicker value="" onChange={vi.fn()} />);

    await waitFor(() => {
      // Wait for load
      expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
    });

    // Carol is inactive — should not appear when showInactive not set
    expect(screen.queryByText(/Carol Davis/)).not.toBeInTheDocument();
  });

  it('shows inactive staff when showInactive prop is set', async () => {
    render(<StaffPicker value="" onChange={vi.fn()} showInactive />);

    await waitFor(() => {
      // Carol (inactive) should now appear
      expect(screen.getByText(/Carol Davis/)).toBeInTheDocument();
    });
  });

  it('calls onChange with the selected staff id on selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StaffPicker value="" onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
    });

    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'S001');

    expect(onChange).toHaveBeenCalledWith('S001');
  });

  it('renders a label when the label prop is provided', async () => {
    api.getHrStaffList.mockReturnValue(new Promise(() => {}));
    render(<StaffPicker value="" onChange={vi.fn()} label="Assigned To" />);
    expect(screen.getByText('Assigned To')).toBeInTheDocument();
  });

  it('shows required asterisk when required prop is set', async () => {
    api.getHrStaffList.mockReturnValue(new Promise(() => {}));
    render(<StaffPicker value="" onChange={vi.fn()} label="Staff Member" required />);
    expect(screen.getByText('Staff Member *')).toBeInTheDocument();
  });

  it('is disabled while loading staff list', () => {
    api.getHrStaffList.mockReturnValue(new Promise(() => {}));
    render(<StaffPicker value="" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('is disabled when disabled prop is passed', async () => {
    render(<StaffPicker value="" onChange={vi.fn()} disabled />);
    await waitFor(() => {
      expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('does not log an error when the staff request is aborted during teardown', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.getHrStaffList.mockImplementation((_home, options = {}) => new Promise((_, reject) => {
      options.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
    }));

    const { unmount } = render(<StaffPicker value="" onChange={vi.fn()} />);
    unmount();
    await Promise.resolve();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
