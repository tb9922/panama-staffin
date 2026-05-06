import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InvestigationMeetings from '../../components/InvestigationMeetings.jsx';
import { createHrMeeting } from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  getHrMeetings: vi.fn().mockResolvedValue([]),
  createHrMeeting: vi.fn(),
}));

vi.mock('../../components/StaffPicker.jsx', () => ({
  default: ({ value, onChange }) => (
    <select aria-label="Staff picker" value={value || ''} onChange={event => onChange(event.target.value)}>
      <option value="">External attendee</option>
      <option value="S001">Alice Example</option>
    </select>
  ),
}));

describe('InvestigationMeetings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prevents duplicate meeting submissions while saving', async () => {
    const user = userEvent.setup();
    let resolveSave;
    createHrMeeting.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));

    render(<InvestigationMeetings caseType="disciplinary" caseId={42} />);

    await user.click(await screen.findByRole('button', { name: /Record Meeting/i }));
    await user.click(screen.getByRole('button', { name: /\+ Add Attendee/i }));
    await user.type(screen.getByLabelText(/Attendee 1 name/i), 'Alice Example');

    const saveButton = screen.getByRole('button', { name: /Save Meeting/i });
    await user.dblClick(saveButton);

    expect(createHrMeeting).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Saving/i })).toBeDisabled();

    resolveSave([]);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Saving/i })).not.toBeInTheDocument();
    });
  });
});
