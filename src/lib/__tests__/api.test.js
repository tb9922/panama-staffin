// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadHomes,
  listEvidenceHubUploaders,
  setCurrentHome,
  uploadCqcEvidenceFile,
} from '../api.js';

function mockResponse(body, { status = 200, contentType = 'application/json' } = {}) {
  const payload = contentType.includes('application/json') && typeof body !== 'string'
    ? JSON.stringify(body)
    : body;
  return new Response(payload, {
    status,
    headers: { 'Content-Type': contentType },
  });
}

describe('api client helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    setCurrentHome(null);
    document.cookie = 'panama_csrf=test-token';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setCurrentHome(null);
  });

  it('returns plain-text success bodies instead of crashing on non-JSON responses', async () => {
    fetch.mockResolvedValueOnce(mockResponse('ok', { contentType: 'text/plain' }));

    await expect(loadHomes()).resolves.toBe('ok');
  });

  it('surfaces plain-text error bodies from failed requests', async () => {
    fetch.mockResolvedValueOnce(mockResponse('Proxy failure', { status: 502, contentType: 'text/plain' }));

    await expect(loadHomes()).rejects.toThrow('Proxy failure');
  });

  it('fails fast when a home-scoped request runs without a selected home', async () => {
    await expect(listEvidenceHubUploaders()).rejects.toThrow('No home selected');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('parses multipart upload success bodies without assuming JSON', async () => {
    setCurrentHome('test-home');
    fetch.mockResolvedValueOnce(mockResponse('uploaded', { contentType: 'text/plain' }));

    const result = await uploadCqcEvidenceFile(
      'cqc_evidence',
      'ev-001',
      new File(['hello'], 'evidence.txt', { type: 'text/plain' }),
      ''
    );

    expect(result).toBe('uploaded');
  });
});
