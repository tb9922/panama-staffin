import crypto from 'node:crypto';
import logger from '../logger.js';
import * as webhookRepo from '../repositories/webhookRepo.js';
import { resolvedToPrivateIp } from '../lib/ssrf.js';

const MAX_RETRIES = 5;
// Exponential backoff: 30s, 2min, 10min, 1hr, 6hr
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];

/**
 * Dispatch a webhook event to all active subscribers for a home.
 * Fire-and-forget — never throws, never blocks the caller.
 * @param {number} homeId
 * @param {string} event - e.g. 'payroll_run.approved'
 * @param {object} payload - event-specific data (no PII — just IDs)
 */
export async function dispatchEvent(homeId, event, payload) {
  try {
    const hooks = await webhookRepo.findActiveByEvent(homeId, event);
    for (const hook of hooks) {
      fireWebhook(hook, event, payload).catch(deliveryErr => {
        logger.error({ err: deliveryErr, webhookId: hook.id, event }, 'Webhook delivery failed');
      });
    }
  } catch (err) {
    // Never throw — webhook failure must not break the parent operation
    logger.error({ err, homeId, event }, 'Webhook dispatch error');
  }
}

/**
 * Calculate the next retry timestamp from now.
 */
export function getNextRetryAt(retryCount) {
  const delayMs = RETRY_DELAYS_MS[retryCount] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
  return new Date(Date.now() + delayMs);
}

async function fireWebhook(hook, event, payload) {
  const timestamp = typeof payload === 'string'
    ? (() => {
        try {
          return JSON.parse(payload)?.timestamp || new Date().toISOString();
        } catch {
          return new Date().toISOString();
        }
      })()
    : new Date().toISOString();
  const body = typeof payload === 'string'
    ? payload // retries pass the original serialised body
    : JSON.stringify({ event, payload, timestamp });
  const signatureBase = `${timestamp}.${body}`;
  const signature = crypto.createHmac('sha256', hook.secret).update(signatureBase).digest('hex');
  const requestId = crypto.randomUUID();
  const start = Date.now();
  let statusCode = null;
  let error = null;

  // Re-validate URL at delivery time to prevent DNS rebinding SSRF
  if (await resolvedToPrivateIp(hook.url)) {
    error = 'Webhook URL resolves to private IP at delivery time — blocked';
    logger.warn({ webhookId: hook.id, url: hook.url }, error);
    webhookRepo.logDelivery(hook.id, event, body, null, 0, error, 'blocked')
      .catch(logErr => logger.warn({ err: logErr }, 'Webhook delivery log failed'));
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Timestamp': timestamp,
        'X-Webhook-Event': event,
        'X-Webhook-Request-ID': requestId,
      },
      body,
      signal: controller.signal,
      redirect: 'manual',
    });
    statusCode = res.status;
    // Reject redirects — following them would bypass the pre-request SSRF validation
    if (statusCode >= 300 && statusCode < 400) {
      error = `Redirect to ${res.headers.get('location') || 'unknown'} blocked (SSRF protection)`;
      statusCode = null;
    }
  } catch (fetchErr) {
    error = fetchErr.message;
  } finally {
    clearTimeout(timeout);
  }

  const responseMs = Date.now() - start;
  const isSuccess = statusCode !== null && statusCode >= 200 && statusCode < 300;

  if (isSuccess) {
    webhookRepo.logDelivery(hook.id, event, body, statusCode, responseMs, null, 'delivered')
      .catch(logErr => logger.warn({ err: logErr, webhookId: hook.id }, 'Webhook delivery log failed'));
  } else {
    // Schedule for retry
    const retryCount = 1;
    const nextRetryAt = getNextRetryAt(0);
    const status = 'pending_retry';
    const deliveryId = await webhookRepo.logDelivery(hook.id, event, body, statusCode, responseMs, error, status)
      .catch(logErr => {
        logger.warn({ err: logErr, webhookId: hook.id }, 'Webhook delivery log failed');
        return null;
      });
    if (deliveryId) {
      await webhookRepo.updateDeliveryForRetry(deliveryId, retryCount, nextRetryAt)
        .catch(err2 => logger.warn({ err: err2, deliveryId }, 'Failed to schedule retry'));
    }
  }
}

/**
 * Process pending webhook retries. Called by background poller in server.js.
 * Returns the number of retries processed.
 */
export async function processRetries() {
  let processed = 0;
  try {
    // Rescue any rows stuck in 'in_progress' for >10 min (process crash during prior fetch)
    const rescued = await webhookRepo.rescueStuckInProgress();
    if (rescued > 0) {
      logger.warn({ rescued }, 'Rescued webhook deliveries stuck in_progress');
    }

    const pending = await webhookRepo.claimPendingRetries(20);
    for (const delivery of pending) {
      // Skip if webhook was deactivated since the original dispatch
      if (!delivery.active) {
        await webhookRepo.markDeliveryFailed(delivery.id);
        processed++;
        continue;
      }

      const start = Date.now();
      let statusCode = null;
      let error = null;

      const body = typeof delivery.payload === 'string'
        ? delivery.payload
        : JSON.stringify(delivery.payload);
      const timestamp = (() => {
        try {
          return JSON.parse(body)?.timestamp || new Date().toISOString();
        } catch {
          return new Date().toISOString();
        }
      })();
      const signatureBase = `${timestamp}.${body}`;
      const signature = crypto.createHmac('sha256', delivery.secret).update(signatureBase).digest('hex');
      const requestId = crypto.randomUUID();

      // Re-validate URL at retry time to prevent DNS rebinding SSRF
      if (await resolvedToPrivateIp(delivery.url)) {
        await webhookRepo.markDeliveryFailed(delivery.id);
        logger.warn({ deliveryId: delivery.id, url: delivery.url }, 'Webhook retry blocked — URL resolves to private IP');
        processed++;
        continue;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(delivery.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': `sha256=${signature}`,
            'X-Webhook-Timestamp': timestamp,
            'X-Webhook-Event': delivery.event,
            'X-Webhook-Request-ID': requestId,
          },
          body,
          signal: controller.signal,
          redirect: 'manual',
        });
        statusCode = res.status;
        // Reject redirects — following them would bypass the pre-request SSRF validation
        if (statusCode >= 300 && statusCode < 400) {
          error = `Redirect to ${res.headers.get('location') || 'unknown'} blocked (SSRF protection)`;
          statusCode = null;
        }
      } catch (fetchErr) {
        error = fetchErr.message;
      } finally {
        clearTimeout(timeout);
      }

      const responseMs = Date.now() - start;
      const isSuccess = statusCode !== null && statusCode >= 200 && statusCode < 300;

      if (isSuccess) {
        await webhookRepo.markDeliverySucceeded(delivery.id, statusCode, responseMs);
        logger.info({ deliveryId: delivery.id, webhookId: delivery.webhook_id, retryCount: delivery.retry_count }, 'Webhook retry succeeded');
      } else if (delivery.retry_count >= MAX_RETRIES) {
        await webhookRepo.markDeliveryFailed(delivery.id);
        logger.warn({ deliveryId: delivery.id, webhookId: delivery.webhook_id, retryCount: delivery.retry_count, error }, 'Webhook max retries exhausted');
      } else {
        const nextRetryAt = getNextRetryAt(delivery.retry_count);
        await webhookRepo.updateDeliveryForRetry(delivery.id, delivery.retry_count + 1, nextRetryAt);
      }
      processed++;
    }
  } catch (err) {
    logger.error({ err }, 'Webhook retry processing error');
  }
  return processed;
}
