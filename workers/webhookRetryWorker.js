import { pool } from '../db.js';
import { config } from '../config.js';
import logger from '../logger.js';
import { purgeDeliveriesOlderThan as purgeWebhookDeliveries } from '../repositories/webhookRepo.js';
import { processRetries as processWebhookRetries } from '../services/webhookService.js';

function startInterval(fn, ms) {
  const timer = setInterval(() => {
    fn().catch((err) => logger.warn({ err: err?.message }, 'webhook worker task failed'));
  }, ms);
  timer.unref();
  return timer;
}

async function run() {
  logger.info({ enableWebhookRetryWorker: config.enableWebhookRetryWorker }, 'webhook retry worker started');

  startInterval(
    async () => {
      await purgeWebhookDeliveries(90);
    },
    24 * 60 * 60 * 1000,
  );

  startInterval(
    async () => {
      await processWebhookRetries();
    },
    30_000,
  );
}

function shutdown(signal) {
  logger.info({ signal }, 'webhook retry worker shutting down');
  pool.end().finally(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

run().catch((err) => {
  logger.error({ err: err?.message, stack: err?.stack }, 'webhook retry worker failed to start');
  process.exit(1);
});
