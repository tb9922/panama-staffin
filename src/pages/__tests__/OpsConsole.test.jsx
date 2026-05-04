import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import OpsConsole from '../OpsConsole.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin', isPlatformAdmin: true })),
    logout: vi.fn(),
    getOpsStatus: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

const payload = {
  generated_at: '2026-05-04T09:00:00.000Z',
  overall: 'warning',
  runtime: {
    status: 'ok',
    environment: 'test',
    node_version: 'v22.0.0',
    platform: 'win32 10.0.0',
    uptime_seconds: 5400,
    git_sha: 'abc123',
    pid: 123,
    memory_mb: { rss: 80, heap_used: 30, heap_total: 60 },
  },
  database: {
    status: 'ok',
    latency_ms: 8,
    database_name: 'panama_test',
    active_homes: 4,
    active_users: 9,
    pool: { max: 15, total: 2, idle: 1, waiting: 0 },
  },
  jobs: {
    status: 'warning',
    available: false,
    message: 'Job queue table is not installed yet',
  },
  upload_scanner: {
    status: 'ok',
    configured: true,
    command: 'clamscan',
    timeout_ms: 30000,
    fail_closed_in_production: false,
  },
  security: {
    status: 'warning',
    allowed_origin_configured: true,
    metrics_endpoint_protected: false,
    trust_proxy: true,
    staff_portal_enabled: true,
    sentry_enabled: false,
  },
};

describe('OpsConsole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getOpsStatus.mockResolvedValue(payload);
  });

  it('renders platform health sections', async () => {
    renderWithProviders(<OpsConsole />, {
      route: '/platform/ops',
      user: { username: 'admin', role: 'admin', isPlatformAdmin: true },
    });

    await waitFor(() => expect(screen.getByText('Ops Console')).toBeInTheDocument());
    expect(screen.getByText('Runtime')).toBeInTheDocument();
    expect(screen.getAllByText('Database').length).toBeGreaterThan(0);
    expect(screen.getByText('Background Work')).toBeInTheDocument();
    expect(screen.getAllByText('clamscan').length).toBeGreaterThan(0);
    expect(screen.getByText('abc123')).toBeInTheDocument();
  });

  it('refreshes without clearing the current payload', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpsConsole />, {
      route: '/platform/ops',
      user: { username: 'admin', role: 'admin', isPlatformAdmin: true },
    });
    await waitFor(() => expect(screen.getByText('abc123')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => expect(api.getOpsStatus).toHaveBeenCalledTimes(2));
    expect(screen.getByText('abc123')).toBeInTheDocument();
  });
});
