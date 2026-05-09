import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import AuditLog from '../AuditLog.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    loadAuditLog: vi.fn(),
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('../../lib/excel.js', () => ({
  downloadXLSX: vi.fn(),
}));

import * as api from '../../lib/api.js';

const MOCK_LOG = [
  { ts: '2026-03-08T10:00:00Z', action: 'login',         home_slug: 'test-home', user_name: 'admin',  details: 'Logged in' },
  { ts: '2026-03-08T10:05:00Z', action: 'override_upsert', home_slug: 'test-home', user_name: 'admin', details: 'Set AL for S001' },
  { ts: '2026-03-08T10:10:00Z', action: 'data_save',     home_slug: 'test-home', user_name: 'viewer', details: 'Config saved' },
];

describe('AuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.loadAuditLog.mockResolvedValue(MOCK_LOG);
  });

  it('renders the page heading', async () => {
    renderWithProviders(<AuditLog />);
    expect(screen.getByText('Audit Log')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('login')).toBeInTheDocument());
  });

  it('shows empty state when no entries', async () => {
    api.loadAuditLog.mockResolvedValue([]);
    renderWithProviders(<AuditLog />);
    await waitFor(() => expect(screen.getByText('No audit entries yet')).toBeInTheDocument());
  });

  it('displays audit entries after load', async () => {
    renderWithProviders(<AuditLog />);
    await waitFor(() => expect(screen.getByText('login')).toBeInTheDocument());
    expect(screen.getByText('override_upsert')).toBeInTheDocument();
    expect(screen.getByText('Set AL for S001')).toBeInTheDocument();
  });

  it('does not render raw Invalid Date for malformed audit timestamps', async () => {
    api.loadAuditLog.mockResolvedValue([
      { ts: 'not-a-date', action: 'login', home_slug: 'test-home', user_name: 'admin', details: 'Malformed timestamp' },
    ]);
    renderWithProviders(<AuditLog />);

    await waitFor(() => expect(screen.getByText('Malformed timestamp')).toBeInTheDocument());
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument();
  });

  it('shows user name and home slug columns', async () => {
    renderWithProviders(<AuditLog />);
    await waitFor(() => expect(screen.getAllByText('admin').length).toBeGreaterThan(0));
    expect(screen.getAllByText('test-home').length).toBeGreaterThan(0);
    expect(screen.getByText('viewer')).toBeInTheDocument();
  });

  it('has Export Excel button', async () => {
    renderWithProviders(<AuditLog />);
    await waitFor(() => expect(screen.getByText('login')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /export excel/i })).toBeInTheDocument();
  });

  it('calls loadAuditLog with large limit on export', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditLog />);
    await waitFor(() => expect(screen.getByText('login')).toBeInTheDocument());

    api.loadAuditLog.mockResolvedValue(MOCK_LOG);
    await user.click(screen.getByRole('button', { name: /export excel/i }));

    await waitFor(() => {
      // Second call should be for export (limit=10000)
      expect(api.loadAuditLog).toHaveBeenCalledTimes(2);
      expect(api.loadAuditLog).toHaveBeenCalledWith(10000);
    });
  });

  it('exports malformed audit timestamps as a dash', async () => {
    const user = userEvent.setup();
    const { downloadXLSX } = await import('../../lib/excel.js');
    api.loadAuditLog
      .mockResolvedValueOnce(MOCK_LOG)
      .mockResolvedValueOnce([
        { ts: 'not-a-date', action: 'login', home_slug: 'test-home', user_name: 'admin', details: 'Malformed timestamp' },
      ]);

    renderWithProviders(<AuditLog />);
    await waitFor(() => expect(screen.getByText('login')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /export excel/i }));

    await waitFor(() => expect(downloadXLSX).toHaveBeenCalled());
    expect(downloadXLSX.mock.calls[0][1][0].rows[0][0]).toBe('-');
  });
});
