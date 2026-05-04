import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../repositories/jobQueueRepo.js', () => ({
  enqueueJob: vi.fn(),
  claimNextJobs: vi.fn(),
  markSucceeded: vi.fn(),
  markFailed: vi.fn(),
  markDead: vi.fn(),
  rescueStuckJobs: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import * as jobQueueRepo from '../../repositories/jobQueueRepo.js';
import logger from '../../logger.js';
import {
  calculateBackoffMs,
  enqueueJob,
  getNextRunAfter,
  processDueJobs,
  processJob,
} from '../../services/jobQueueService.js';

const NOW = new Date('2026-05-04T12:00:00.000Z');

function makeJob(overrides = {}) {
  return {
    id: 101,
    type: 'pdf.generate',
    payload: { documentId: 55 },
    status: 'running',
    attempts: 1,
    max_attempts: 3,
    ...overrides,
  };
}

describe('jobQueueService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    jobQueueRepo.enqueueJob.mockResolvedValue(makeJob({ status: 'queued', attempts: 0, inserted: true }));
    jobQueueRepo.claimNextJobs.mockResolvedValue([]);
    jobQueueRepo.markSucceeded.mockResolvedValue(makeJob({ status: 'succeeded' }));
    jobQueueRepo.markFailed.mockResolvedValue(makeJob({ status: 'failed' }));
    jobQueueRepo.markDead.mockResolvedValue(makeJob({ status: 'dead' }));
    jobQueueRepo.rescueStuckJobs.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates deterministic capped retry delays from the claimed attempt count', () => {
    expect(calculateBackoffMs(1)).toBe(30_000);
    expect(calculateBackoffMs(2)).toBe(120_000);
    expect(calculateBackoffMs(3)).toBe(600_000);
    expect(calculateBackoffMs(99)).toBe(21_600_000);
    expect(getNextRunAfter(2, NOW)).toEqual(new Date('2026-05-04T12:02:00.000Z'));
  });

  it('enqueues a validated JSON job with idempotency metadata', async () => {
    const runAfter = new Date('2026-05-04T13:00:00.000Z');

    const result = await enqueueJob(
      ' pdf.generate ',
      { documentId: 55 },
      { idempotencyKey: 'pdf:55', runAfter, maxAttempts: 4 },
    );

    expect(result.inserted).toBe(true);
    expect(jobQueueRepo.enqueueJob).toHaveBeenCalledWith({
      type: 'pdf.generate',
      payload: { documentId: 55 },
      runAfter,
      idempotencyKey: 'pdf:55',
      maxAttempts: 4,
    });
  });

  it('rejects invalid job types before touching the repository', async () => {
    await expect(enqueueJob('', {})).rejects.toThrow(/job type/i);
    expect(jobQueueRepo.enqueueJob).not.toHaveBeenCalled();
  });

  it('marks a claimed job succeeded after its registered handler resolves', async () => {
    const job = makeJob();
    const handler = vi.fn().mockResolvedValue();

    const result = await processJob(job, { 'pdf.generate': handler }, { now: NOW });

    expect(handler).toHaveBeenCalledWith(job.payload, job);
    expect(jobQueueRepo.markSucceeded).toHaveBeenCalledWith(job.id, { lockedBy: null, attempts: 1 });
    expect(result).toEqual({ id: job.id, type: job.type, status: 'succeeded' });
  });

  it('marks a failed job for retry using backoff while attempts remain', async () => {
    const job = makeJob({ attempts: 1, max_attempts: 3 });
    const handler = vi.fn().mockRejectedValue(new Error('PDF renderer unavailable'));

    const result = await processJob(job, { 'pdf.generate': handler }, { now: NOW });

    expect(jobQueueRepo.markFailed).toHaveBeenCalledWith(job.id, {
      error: 'PDF renderer unavailable',
      runAfter: new Date('2026-05-04T12:00:30.000Z'),
      lockedBy: null,
      attempts: 1,
    });
    expect(jobQueueRepo.markDead).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: job.id, type: job.type, status: 'failed' });
  });

  it('marks a job dead instead of retrying once max attempts are exhausted', async () => {
    const job = makeJob({ attempts: 3, max_attempts: 3 });
    const handler = vi.fn().mockRejectedValue(new Error('OCR timeout'));

    const result = await processJob(job, { 'pdf.generate': handler }, { now: NOW });

    expect(jobQueueRepo.markDead).toHaveBeenCalledWith(job.id, {
      error: 'OCR timeout',
      lockedBy: null,
      attempts: 3,
    });
    expect(jobQueueRepo.markFailed).not.toHaveBeenCalled();
    expect(result).toEqual({ id: job.id, type: job.type, status: 'dead', error: 'OCR timeout' });
  });

  it('treats missing handlers as retryable failures rather than deleting work', async () => {
    const job = makeJob({ type: 'uploads.ocr', attempts: 1, max_attempts: 2 });

    const result = await processJob(job, {}, { now: NOW });

    expect(jobQueueRepo.markFailed).toHaveBeenCalledWith(job.id, {
      error: 'No handler registered for job type "uploads.ocr"',
      runAfter: new Date('2026-05-04T12:00:30.000Z'),
      lockedBy: null,
      attempts: 1,
    });
    expect(result.status).toBe('failed');
  });

  it('does not report success when a stale worker loses its claim', async () => {
    const job = makeJob({ locked_by: 'worker-a', attempts: 2 });
    const handler = vi.fn().mockResolvedValue();
    jobQueueRepo.markSucceeded.mockResolvedValueOnce(null);

    const result = await processJob(job, { 'pdf.generate': handler }, { now: NOW });

    expect(jobQueueRepo.markSucceeded).toHaveBeenCalledWith(job.id, { lockedBy: 'worker-a', attempts: 2 });
    expect(result).toEqual({ id: job.id, type: job.type, status: 'stale' });
  });

  it('claims due work, processes it, and summarizes outcomes', async () => {
    const job = makeJob({ id: 222 });
    const handler = vi.fn().mockResolvedValue();
    jobQueueRepo.claimNextJobs.mockResolvedValue([job]);

    const summary = await processDueJobs({
      handlers: { 'pdf.generate': handler },
      workerId: 'worker-a',
      limit: 2,
      types: ['pdf.generate'],
      rescueStuck: false,
      now: NOW,
    });

    expect(jobQueueRepo.claimNextJobs).toHaveBeenCalledWith({
      limit: 2,
      workerId: 'worker-a',
      types: ['pdf.generate'],
    });
    expect(summary).toEqual({
      claimed: 1,
      processed: 1,
      succeeded: 1,
      failed: 0,
      dead: 0,
      skipped: false,
    });
  });

  it('skips overlapping processing loops in the same process', async () => {
    let releaseClaim;
    jobQueueRepo.claimNextJobs.mockImplementationOnce(
      () => new Promise(resolve => {
        releaseClaim = resolve;
      }),
    );

    const first = processDueJobs({ workerId: 'worker-a', rescueStuck: false, now: NOW });
    await Promise.resolve();
    const second = await processDueJobs({ workerId: 'worker-a', rescueStuck: false, now: NOW });

    expect(second).toEqual({
      claimed: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
      skipped: true,
    });
    expect(logger.warn).toHaveBeenCalledWith('Job queue processing already running - skipping overlap');

    releaseClaim([]);
    await first;
  });
});
