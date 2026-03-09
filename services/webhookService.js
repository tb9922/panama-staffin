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
      fireWebhook(hook, event, payload).catch(err => {
        logger.error({ err, webhookId: hook.id, event }, 'Webhook delivery failed');
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

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
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
    clearTimeout(timeout);
    statusCode = res.status;
  } catch (err) {
    error = err.message;
  }

  const responseMs = Date.now() - start;
  // Log delivery — fire-and-forget
  webhookRepo.logDelivery(hook.id, event, body, statusCode, responseMs, error).catch(() => {});
}
