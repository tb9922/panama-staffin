import { pool } from '../db.js';
import logger from '../logger.js';
import { processDueJobs, rescueStuckJobs } from '../services/jobQueueService.js';

const DEFAULT_POLL_MS = 30_000;
const DEFAULT_RESCUE_MS = 5 * 60 * 1000;
const DEFAULT_RESCUE_STALE_AFTER_MS = 10 * 60 * 1000;

const defaultHandlers = Object.freeze({});

function defaultWorkerId() {
  return `job-queue-${process.pid}`;
}

function startInterval(fn, ms, label) {
  const timer = setInterval(() => {
    fn().catch((err) => logger.warn({ err: err?.message }, `${label} failed`));
  }, ms);
  return timer;
}

export function startJobQueueWorker({
  handlers = defaultHandlers,
  workerId = defaultWorkerId(),
  pollMs = DEFAULT_POLL_MS,
  claimLimit = 5,
  rescueEveryMs = DEFAULT_RESCUE_MS,
  rescueStaleAfterMs = DEFAULT_RESCUE_STALE_AFTER_MS,
} = {}) {
  const registeredTypes = Object.keys(handlers);
  logger.info({ workerId, registeredTypes }, 'job queue worker started');

  if (registeredTypes.length === 0) {
    logger.warn('job queue worker has no registered handlers; claim polling is disabled');
  }

  const runOnce = async () => {
    if (registeredTypes.length === 0) {
      return { claimed: 0, processed: 0, succeeded: 0, failed: 0, dead: 0, skipped: false };
    }
    return processDueJobs({
      handlers,
      workerId,
      limit: claimLimit,
      types: registeredTypes,
      rescueStuck: false,
    });
  };

  const pollTimer = startInterval(runOnce, pollMs, 'job queue poll');
  const rescueTimer = startInterval(
    async () => {
      await rescueStuckJobs({ staleAfterMs: rescueStaleAfterMs });
    },
    rescueEveryMs,
    'job queue stale-lock rescue',
  );

  runOnce().catch((err) => logger.warn({ err: err?.message }, 'job queue initial poll failed'));

  return {
    workerId,
    runOnce,
    stop() {
      clearInterval(pollTimer);
      clearInterval(rescueTimer);
      logger.info({ workerId }, 'job queue worker stopped');
    },
  };
}

function shutdown(worker, signal) {
  logger.info({ signal, workerId: worker.workerId }, 'job queue worker shutting down');
  worker.stop();
  pool.end().finally(() => process.exit(0));
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('/workers/jobQueueWorker.js');

if (isDirectRun) {
  const worker = startJobQueueWorker();
  process.on('SIGTERM', () => shutdown(worker, 'SIGTERM'));
  process.on('SIGINT', () => shutdown(worker, 'SIGINT'));
}
