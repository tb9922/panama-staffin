import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import useAutoFormControlLabels from '../useAutoFormControlLabels.js';

function Harness() {
  useAutoFormControlLabels();
  return (
    <div>
      <input placeholder="Search staff..." />
      <select defaultValue="all">
        <option value="all">All Teams</option>
        <option value="day">Day Team</option>
      </select>
      <label htmlFor="already-labelled">Existing label</label>
      <input id="already-labelled" />
    </div>
  );
}

describe('useAutoFormControlLabels', () => {
  it('adds fallback labels without overwriting explicit labels', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Search staff' })).toBeInTheDocument();
    });

    expect(screen.getByRole('combobox', { name: /All Teams filter|Day Team filter/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Existing label')).not.toHaveAttribute('data-auto-a11y-label');
  });
});
