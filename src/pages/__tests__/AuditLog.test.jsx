import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import AuditLog from '../AuditLog.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    loadAuditLog: vi.fn(),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

const RESULT = {
  total: 2,
  rows: [
    { id: 1, ts: '2026-04-14T09:00:00Z', action: 'login', home_slug: 'oakwood', user_name: 'alice', details: '{"ip":"127.0.0.1"}' },
    { id: 2, ts: '2026-04-14T10:00:00Z', action: 'payroll_update', home_slug: 'amberwood', user_name: 'bob', details: '{"entity":"run"}' },
  ],
};

describe('AuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.loadAuditLog.mockResolvedValue(RESULT);
  });

  it('renders audit rows and summary count', async () => {
    renderWithProviders(<AuditLog />);

    await waitFor(() => expect(screen.getByText('Audit Log')).toBeInTheDocument());
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText(/2 matching rows/i)).toBeInTheDocument();
  });

  it('reloads the list when filters change', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditLog />);

    await waitFor(() => expect(api.loadAuditLog).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 })));

    await user.type(screen.getByPlaceholderText(/login, payroll_update/i), 'login');

    await waitFor(() => {
      expect(api.loadAuditLog).toHaveBeenLastCalledWith(expect.objectContaining({
        limit: 50,
        offset: 0,
        action: 'login',
      }));
    });
  });
});
