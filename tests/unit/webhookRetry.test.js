/**
 * Unit tests for webhook retry logic.
 * Tests backoff calculation, max retry transition, and repo retry functions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getNextRetryAt } from '../../services/webhookService.js';
import { pool } from '../../db.js';
import * as webhookRepo from '../../repositories/webhookRepo.js';

// ── Backoff calculation ──────────────────────────────────────────────────────

describe('getNextRetryAt', () => {
  it('returns a date in the future', () => {
    const now = Date.now();
    const next = getNextRetryAt(0);
    expect(next).toBeInstanceOf(Date);
    expect(next.getTime()).toBeGreaterThanOrEqual(now);
  });

  it('increases delay with retry count', () => {
    const d0 = getNextRetryAt(0);
    const d1 = getNextRetryAt(1);
    const d2 = getNextRetryAt(2);
    expect(d1.getTime()).toBeGreaterThan(d0.getTime());
    expect(d2.getTime()).toBeGreaterThan(d1.getTime());
  });

  it('first retry is ~30 seconds', () => {
    const now = Date.now();
    const next = getNextRetryAt(0);
    const diffMs = next.getTime() - now;
    expect(diffMs).toBeGreaterThanOrEqual(29_000);
    expect(diffMs).toBeLessThan(32_000);
  });

  it('caps at last delay for high retry counts', () => {
    const d5 = getNextRetryAt(5);
    const d99 = getNextRetryAt(99);
    // Both should use the same delay (6hr) since they're beyond the array
    const diff = Math.abs(d99.getTime() - d5.getTime());
    expect(diff).toBeLessThan(1000); // within 1s (execution time)
  });
});

// ── Repo retry functions ─────────────────────────────────────────────────────

describe('webhookRepo retry functions', () => {
  let testHomeId;
  let testWebhookId;

  beforeAll(async () => {
    // Create test home + webhook
    const { rows: [h] } = await pool.query(
      `INSERT INTO homes (slug, name) VALUES ('webhook-retry-test', 'Webhook Retry Test') RETURNING id`
    );
    testHomeId = h.id;

    const { rows: [w] } = await pool.query(
      `INSERT INTO webhooks (home_id, url, secret, events, active)
       VALUES ($1, 'https://example.com/hook', 'test-secret-1234567890', '{override.created}', true)
       RETURNING id`,
      [testHomeId]
    );
    testWebhookId = w.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM webhook_deliveries WHERE webhook_id = $1', [testWebhookId]);
    await pool.query('DELETE FROM webhooks WHERE id = $1', [testWebhookId]);
    await pool.query('DELETE FROM homes WHERE id = $1', [testHomeId]);
  });

  it('logDelivery returns delivery ID', async () => {
    const id = await webhookRepo.logDelivery(
      testWebhookId, 'override.created', '{"test":true}', 200, 50, null, 'delivered'
    );
    expect(id).toBeGreaterThan(0);
  });

  it('logDelivery with pending_retry status', async () => {
    const id = await webhookRepo.logDelivery(
      testWebhookId, 'override.created', '{"test":true}', null, 100, 'timeout', 'pending_retry'
    );
    expect(id).toBeGreaterThan(0);

    // Verify status was stored
    const { rows } = await pool.query(
      'SELECT status, error FROM webhook_deliveries WHERE id = $1',
      [id]
    );
    expect(rows[0].status).toBe('pending_retry');
    expect(rows[0].error).toBe('timeout');
  });

  it('updateDeliveryForRetry sets retry_count and next_retry_at', async () => {
    const id = await webhookRepo.logDelivery(
      testWebhookId, 'override.created', '{"test":true}', null, 100, 'connection refused', 'pending_retry'
    );
    const nextRetry = new Date(Date.now() + 30_000);
    await webhookRepo.updateDeliveryForRetry(id, 2, nextRetry);

    const { rows } = await pool.query(
      'SELECT retry_count, next_retry_at, status FROM webhook_deliveries WHERE id = $1',
      [id]
    );
    expect(rows[0].retry_count).toBe(2);
    expect(rows[0].status).toBe('pending_retry');
    expect(rows[0].next_retry_at).not.toBeNull();
  });

  it('markDeliverySucceeded clears error and sets delivered', async () => {
    const id = await webhookRepo.logDelivery(
      testWebhookId, 'override.created', '{"test":true}', null, 100, 'timeout', 'pending_retry'
    );
    await webhookRepo.markDeliverySucceeded(id, 200, 45);

    const { rows } = await pool.query(
      'SELECT status, status_code, response_ms, error, next_retry_at FROM webhook_deliveries WHERE id = $1',
      [id]
    );
    expect(rows[0].status).toBe('delivered');
    expect(rows[0].status_code).toBe(200);
    expect(rows[0].response_ms).toBe(45);
    expect(rows[0].error).toBeNull();
    expect(rows[0].next_retry_at).toBeNull();
  });

  it('markDeliveryFailed sets status to failed', async () => {
    const id = await webhookRepo.logDelivery(
      testWebhookId, 'override.created', '{"test":true}', null, 100, 'max retries', 'pending_retry'
    );
    await webhookRepo.markDeliveryFailed(id);

    const { rows } = await pool.query(
      'SELECT status, next_retry_at FROM webhook_deliveries WHERE id = $1',
      [id]
    );
    expect(rows[0].status).toBe('failed');
    expect(rows[0].next_retry_at).toBeNull();
  });

  it('findPendingRetries returns deliveries due for retry', async () => {
    // Insert a delivery with next_retry_at in the past
    const id = await webhookRepo.logDelivery(
      testWebhookId, 'override.created', '{"retry":"test"}', null, 100, 'timeout', 'pending_retry'
    );
    await pool.query(
      `UPDATE webhook_deliveries SET retry_count = 1, next_retry_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [id]
    );

    const pending = await webhookRepo.findPendingRetries(10);
    const found = pending.find(d => d.id === id);
    expect(found).toBeDefined();
    expect(found.retry_count).toBe(1);
    expect(found.event).toBe('override.created');
    expect(found.url).toBe('https://example.com/hook');

    // Clean up
    await webhookRepo.markDeliveryFailed(id);
  });

  it('findPendingRetries skips future retries', async () => {
    const id = await webhookRepo.logDelivery(
      testWebhookId, 'override.created', '{"future":"test"}', null, 100, 'timeout', 'pending_retry'
    );
    await pool.query(
      `UPDATE webhook_deliveries SET retry_count = 1, next_retry_at = NOW() + INTERVAL '1 hour' WHERE id = $1`,
      [id]
    );

    const pending = await webhookRepo.findPendingRetries(100);
    const found = pending.find(d => d.id === id);
    expect(found).toBeUndefined();

    // Clean up
    await webhookRepo.markDeliveryFailed(id);
  });

  it('getRecentDeliveries includes retry columns', async () => {
    const id = await webhookRepo.logDelivery(
      testWebhookId, 'override.created', '{"cols":"test"}', null, 100, 'timeout', 'pending_retry'
    );
    await webhookRepo.updateDeliveryForRetry(id, 3, new Date(Date.now() + 60_000));

    const deliveries = await webhookRepo.getRecentDeliveries(testWebhookId, testHomeId);
    const found = deliveries.find(d => d.id === id);
    expect(found).toBeDefined();
    expect(found.retry_count).toBe(3);
    expect(found.status).toBe('pending_retry');
    expect(found.next_retry_at).not.toBeNull();
  });

  it('getRecentDeliveries filters by status', async () => {
    // We have mixed statuses from previous tests
    const failed = await webhookRepo.getRecentDeliveries(testWebhookId, testHomeId, { status: 'failed' });
    for (const d of failed) {
      expect(d.status).toBe('failed');
    }

    const delivered = await webhookRepo.getRecentDeliveries(testWebhookId, testHomeId, { status: 'delivered' });
    for (const d of delivered) {
      expect(d.status).toBe('delivered');
    }
  });
});
