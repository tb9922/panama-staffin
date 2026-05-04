import logger from '../logger.js';
import * as jobQueueRepo from '../repositories/jobQueueRepo.js';

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_CLAIM_LIMIT = 5;
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];

let processing = false;

function assertJobType(type) {
  if (typeof type !== 'string' || type.trim().length === 0) {
    throw new TypeError('Job type must be a non-empty string');
  }
  return type.trim();
}

function assertMaxAttempts(maxAttempts = DEFAULT_MAX_ATTEMPTS) {
  const parsed = Number.parseInt(maxAttempts, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new TypeError('maxAttempts must be a positive integer');
  }
  return parsed;
}

function assertJsonPayload(payload = {}) {
  try {
    const serialized = JSON.stringify(payload ?? {});
    if (serialized === undefined) {
      throw new TypeError('Job payload must be JSON serializable');
    }
  } catch (err) {
    throw new TypeError(`Job payload must be JSON serializable: ${err.message}`);
  }
  return payload ?? {};
}

function normalizeError(error) {
  if (error == null) return null;
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 4000);
}

function countResult(acc, result) {
  acc.processed += 1;
  if (result.status === 'succeeded') acc.succeeded += 1;
  else if (result.status === 'dead') acc.dead += 1;
  else if (result.status === 'failed') acc.failed += 1;
  return acc;
}

export function calculateBackoffMs(attempts) {
  const attemptNumber = Math.max(Number.parseInt(attempts, 10) || 1, 1);
  const delayIndex = Math.min(attemptNumber - 1, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[delayIndex];
}

export function getNextRunAfter(attempts, now = new Date()) {
  return new Date(now.getTime() + calculateBackoffMs(attempts));
}

export async function enqueueJob(type, payload = {}, options = {}) {
  const normalizedType = assertJobType(type);
  const normalizedPayload = assertJsonPayload(payload);
  const maxAttempts = assertMaxAttempts(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

  return jobQueueRepo.enqueueJob({
    type: normalizedType,
    payload: normalizedPayload,
    runAfter: options.runAfter ?? null,
    idempotencyKey: options.idempotencyKey ?? null,
    maxAttempts,
  });
}

export async function claimJobs({ limit = DEFAULT_CLAIM_LIMIT, workerId = null, types = null } = {}) {
  return jobQueueRepo.claimNextJobs({ limit, workerId, types });
}

async function markJobFailure(job, error, now = new Date()) {
  const normalizedError = normalizeError(error);
  const attempts = Number.parseInt(job.attempts, 10) || 0;
  const maxAttempts = Number.parseInt(job.max_attempts, 10) || DEFAULT_MAX_ATTEMPTS;
  const guard = { lockedBy: job.locked_by ?? null, attempts };

  if (attempts >= maxAttempts) {
    const updated = await jobQueueRepo.markDead(job.id, { error: normalizedError, ...guard });
    if (!updated) return { id: job.id, type: job.type, status: 'stale', error: normalizedError };
    return { id: job.id, type: job.type, status: 'dead', error: normalizedError };
  }

  const runAfter = getNextRunAfter(attempts, now);
  const updated = await jobQueueRepo.markFailed(job.id, { error: normalizedError, runAfter, ...guard });
  if (!updated) return { id: job.id, type: job.type, status: 'stale', error: normalizedError, runAfter };
  return { id: job.id, type: job.type, status: 'failed', error: normalizedError, runAfter };
}

export async function processJob(job, handlers = {}, options = {}) {
  const handler = handlers[job.type];
  if (typeof handler !== 'function') {
    return markJobFailure(job, new Error(`No handler registered for job type "${job.type}"`), options.now);
  }

  try {
    await handler(job.payload, job);
  } catch (err) {
    return markJobFailure(job, err, options.now);
  }

  const updated = await jobQueueRepo.markSucceeded(job.id, {
    lockedBy: job.locked_by ?? null,
    attempts: Number.parseInt(job.attempts, 10) || 0,
  });
  if (!updated) return { id: job.id, type: job.type, status: 'stale' };
  return { id: job.id, type: job.type, status: 'succeeded' };
}

export async function processDueJobs({
  handlers = {},
  workerId = null,
  limit = DEFAULT_CLAIM_LIMIT,
  types = null,
  rescueStuck = true,
  rescueOptions = {},
  now = new Date(),
} = {}) {
  if (processing) {
    logger.warn('Job queue processing already running - skipping overlap');
    return { claimed: 0, processed: 0, succeeded: 0, failed: 0, dead: 0, skipped: true };
  }

  processing = true;
  try {
    if (rescueStuck) {
      const rescued = await jobQueueRepo.rescueStuckJobs(rescueOptions);
      if (rescued.length > 0) {
        logger.warn({ rescued: rescued.length }, 'Rescued stale job queue locks');
      }
    }

    const jobs = await claimJobs({ limit, workerId, types });
    const summary = { claimed: jobs.length, processed: 0, succeeded: 0, failed: 0, dead: 0, skipped: false };

    for (const job of jobs) {
      const result = await processJob(job, handlers, { now });
      countResult(summary, result);
    }

    return summary;
  } catch (err) {
    logger.error({ err }, 'Job queue processing error');
    return {
      claimed: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
      skipped: false,
      error: normalizeError(err),
    };
  } finally {
    processing = false;
  }
}

export async function rescueStuckJobs(options = {}) {
  const jobs = await jobQueueRepo.rescueStuckJobs(options);
  return { rescued: jobs.length, jobs };
}
