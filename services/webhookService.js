import crypto from 'node:crypto';
import logger from '../logger.js';
import * as webhookRepo from '../repositories/webhookRepo.js';

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

async function fireWebhook(hook, event, payload) {
  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  const signature = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
  const start = Date.now();
  let statusCode = null;
  let error = null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': event,
      },
      body,
      signal: controller.signal,
    });
    statusCode = res.status;
  } catch (fetchErr) {
    error = fetchErr.message;
  } finally {
    clearTimeout(timeout);
  }

  const responseMs = Date.now() - start;
  webhookRepo.logDelivery(hook.id, event, body, statusCode, responseMs, error)
    .catch(logErr => logger.warn({ err: logErr, webhookId: hook.id }, 'Webhook delivery log failed'));
}
