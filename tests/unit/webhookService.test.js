import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../repositories/webhookRepo.js', () => ({
  findActiveByEvent: vi.fn().mockResolvedValue([]),
  logDelivery: vi.fn().mockResolvedValue(),
}));

vi.mock('../../logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../lib/ssrf.js', () => ({
  resolvedToPrivateIp: vi.fn().mockResolvedValue(false),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { dispatchEvent } from '../../services/webhookService.js';
import * as webhookRepo from '../../repositories/webhookRepo.js';
import logger from '../../logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHook(overrides = {}) {
  return {
    id: 1,
    home_id: 42,
    url: 'https://example.com/webhook',
    secret: 'test-secret-minimum-16',
    events: ['incident.created'],
    active: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('webhookService', () => {
  let fetchSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('does not make HTTP calls when no active webhooks match', async () => {
    webhookRepo.findActiveByEvent.mockResolvedValue([]);
    await dispatchEvent(42, 'incident.created', { id: 'inc-1' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends POST with correct headers when a matching webhook exists', async () => {
    const hook = makeHook();
    webhookRepo.findActiveByEvent.mockResolvedValue([hook]);

    await dispatchEvent(42, 'incident.created', { id: 'inc-1' });

    // Wait for fire-and-forget to complete
    await new Promise(r => setTimeout(r, 50));

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://example.com/webhook');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-Webhook-Event']).toBe('incident.created');
    expect(opts.headers['X-Webhook-Signature']).toMatch(/^sha256=[a-f0-9]+$/);
    expect(opts.headers['X-Webhook-Timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('generates correct HMAC-SHA256 signature', async () => {
    const hook = makeHook({ secret: 'my-webhook-secret-key' });
    webhookRepo.findActiveByEvent.mockResolvedValue([hook]);

    await dispatchEvent(42, 'incident.created', { id: 'inc-1' });
    await new Promise(r => setTimeout(r, 50));

    const [, opts] = fetchSpy.mock.calls[0];
    const body = opts.body;
    const timestamp = opts.headers['X-Webhook-Timestamp'];
    const expectedSig = crypto.createHmac('sha256', 'my-webhook-secret-key').update(`${timestamp}.${body}`).digest('hex');
    expect(opts.headers['X-Webhook-Signature']).toBe(`sha256=${expectedSig}`);
  });

  it('sends correct JSON body with event, payload, and timestamp', async () => {
    const hook = makeHook();
    webhookRepo.findActiveByEvent.mockResolvedValue([hook]);

    await dispatchEvent(42, 'incident.created', { incidentId: 'inc-1', severity: 'major' });
    await new Promise(r => setTimeout(r, 50));

    const [, opts] = fetchSpy.mock.calls[0];
    const parsed = JSON.parse(opts.body);
    expect(parsed.event).toBe('incident.created');
    expect(parsed.payload).toEqual({ incidentId: 'inc-1', severity: 'major' });
    expect(parsed.timestamp).toBeTruthy();
  });

  it('logs delivery after successful call', async () => {
    const hook = makeHook();
    webhookRepo.findActiveByEvent.mockResolvedValue([hook]);

    await dispatchEvent(42, 'incident.created', { id: 'inc-1' });
    await new Promise(r => setTimeout(r, 50));

    expect(webhookRepo.logDelivery).toHaveBeenCalledOnce();
    const [webhookId, event, , statusCode, responseMs, error] = webhookRepo.logDelivery.mock.calls[0];
    expect(webhookId).toBe(1);
    expect(event).toBe('incident.created');
    expect(statusCode).toBe(200);
    expect(responseMs).toBeTypeOf('number');
    expect(error).toBeNull();
  });

  it('logs delivery with error when fetch fails', async () => {
    const hook = makeHook();
    webhookRepo.findActiveByEvent.mockResolvedValue([hook]);
    fetchSpy.mockRejectedValue(new Error('Connection refused'));

    await dispatchEvent(42, 'incident.created', { id: 'inc-1' });
    await new Promise(r => setTimeout(r, 50));

    expect(webhookRepo.logDelivery).toHaveBeenCalledOnce();
    const [, , , statusCode, , error] = webhookRepo.logDelivery.mock.calls[0];
    expect(statusCode).toBeNull();
    expect(error).toBe('Connection refused');
  });

  it('never throws even when findActiveByEvent fails', async () => {
    webhookRepo.findActiveByEvent.mockRejectedValue(new Error('DB down'));

    // Should not throw
    await expect(dispatchEvent(42, 'incident.created', { id: 'inc-1' })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('never throws even when fetch throws', async () => {
    const hook = makeHook();
    webhookRepo.findActiveByEvent.mockResolvedValue([hook]);
    fetchSpy.mockRejectedValue(new Error('Network error'));

    // Should not throw
    await expect(dispatchEvent(42, 'incident.created', { id: 'inc-1' })).resolves.toBeUndefined();
  });

  it('dispatches to multiple webhooks when several match', async () => {
    const hook1 = makeHook({ id: 1 });
    const hook2 = makeHook({ id: 2, url: 'https://other.com/hook' });
    webhookRepo.findActiveByEvent.mockResolvedValue([hook1, hook2]);

    await dispatchEvent(42, 'incident.created', { id: 'inc-1' });
    await new Promise(r => setTimeout(r, 50));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://example.com/webhook');
    expect(fetchSpy.mock.calls[1][0]).toBe('https://other.com/hook');
  });

  it('treats HTTP redirect as failure (SSRF protection)', async () => {
    const hook = makeHook();
    webhookRepo.findActiveByEvent.mockResolvedValue([hook]);
    webhookRepo.logDelivery.mockResolvedValue('del-1');

    fetchSpy.mockResolvedValue({
      status: 302,
      headers: { get: (h) => h === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null },
    });

    await dispatchEvent(42, 'incident.created', { id: 'inc-1' });
    await new Promise(r => setTimeout(r, 50));

    // Should log as failure with SSRF error, not as success
    expect(webhookRepo.logDelivery).toHaveBeenCalledOnce();
    const [, , , statusCode, , error, status] = webhookRepo.logDelivery.mock.calls[0];
    expect(statusCode).toBeNull();
    expect(error).toMatch(/redirect.*blocked.*SSRF/i);
    expect(status).toBe('pending_retry');
  });

  it('passes redirect: manual to fetch', async () => {
    const hook = makeHook();
    webhookRepo.findActiveByEvent.mockResolvedValue([hook]);

    await dispatchEvent(42, 'incident.created', { id: 'inc-1' });
    await new Promise(r => setTimeout(r, 50));

    const [, opts] = fetchSpy.mock.calls[0];
    expect(opts.redirect).toBe('manual');
  });

  it('logs error but does not throw when one webhook fails', async () => {
    const hook1 = makeHook({ id: 1 });
    const hook2 = makeHook({ id: 2, url: 'https://failing.com/hook' });
    webhookRepo.findActiveByEvent.mockResolvedValue([hook1, hook2]);

    let callCount = 0;
    fetchSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 2) return Promise.reject(new Error('timeout'));
      return Promise.resolve({ status: 200 });
    });

    await expect(dispatchEvent(42, 'incident.created', { id: 'inc-1' })).resolves.toBeUndefined();
    await new Promise(r => setTimeout(r, 50));

    // Both deliveries should be logged
    expect(webhookRepo.logDelivery).toHaveBeenCalledTimes(2);
  });
});
