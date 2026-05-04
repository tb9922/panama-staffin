import { pool, withTransaction } from '../db.js';

const JOB_COLUMNS = [
  'id',
  'type',
  'payload',
  'status',
  'attempts',
  'max_attempts',
  'run_after',
  'locked_at',
  'locked_by',
  'idempotency_key',
  'error',
  'created_at',
  'updated_at',
];

const COLS = JOB_COLUMNS.join(', ');
const TARGET_COLS = JOB_COLUMNS.map(col => `j.${col}`).join(', ');
const CLAIMED_COLS = JOB_COLUMNS.map(col => `c.${col}`).join(', ');

function shapeRow(row) {
  if (!row) return null;
  return {
    ...row,
    attempts: Number.parseInt(row.attempts, 10),
    max_attempts: Number.parseInt(row.max_attempts, 10),
  };
}

function normalizeLimit(limit, fallback = 1, max = 100) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

function normalizeTypes(types) {
  if (!Array.isArray(types) || types.length === 0) return null;
  return types.map(type => String(type).trim()).filter(Boolean);
}

export async function enqueueJob(data, client = pool) {
  const payload = data.payload == null ? {} : data.payload;
  const idempotencyKey = data.idempotencyKey ?? data.idempotency_key ?? null;
  const runAfter = data.runAfter ?? data.run_after ?? null;
  const maxAttempts = Number.parseInt(data.maxAttempts ?? data.max_attempts ?? 5, 10);

  const { rows } = await client.query(
    `WITH inserted AS (
       INSERT INTO job_queue (type, payload, run_after, idempotency_key, max_attempts)
       VALUES ($1, $2::jsonb, COALESCE($3::timestamptz, NOW()), $4, $5)
       ON CONFLICT (type, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING ${COLS}, true AS inserted
     ),
     existing AS (
       SELECT ${COLS}, false AS inserted
         FROM job_queue
        WHERE type = $1
          AND idempotency_key = $4
          AND $4::text IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM inserted)
        LIMIT 1
     )
     SELECT * FROM inserted
     UNION ALL
     SELECT * FROM existing
     LIMIT 1`,
    [
      data.type,
      JSON.stringify(payload),
      runAfter,
      idempotencyKey,
      Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 5,
    ],
  );

  const row = shapeRow(rows[0]);
  return row ? { ...row, inserted: row.inserted } : null;
}

export async function findById(id, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM job_queue
      WHERE id = $1`,
    [id],
  );
  return shapeRow(rows[0]);
}

export async function claimNextJobs({ limit = 1, workerId, types = null } = {}) {
  const cappedLimit = normalizeLimit(limit, 1, 50);
  const jobTypes = normalizeTypes(types);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `WITH selected AS (
         SELECT id, run_after
           FROM job_queue
          WHERE status IN ('queued', 'failed')
            AND run_after <= NOW()
            AND attempts < max_attempts
            AND ($3::text[] IS NULL OR type = ANY($3::text[]))
          ORDER BY run_after ASC, id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       ),
       claimed AS (
         UPDATE job_queue j
            SET status = 'running',
                attempts = j.attempts + 1,
                locked_at = NOW(),
                locked_by = $2,
                error = NULL,
                updated_at = NOW()
           FROM selected s
          WHERE j.id = s.id
          RETURNING ${TARGET_COLS}
       )
       SELECT ${CLAIMED_COLS}
         FROM claimed c
         JOIN selected s ON s.id = c.id
        ORDER BY s.run_after ASC, s.id ASC`,
      [cappedLimit, workerId || null, jobTypes],
    );
    return rows.map(shapeRow);
  });
}

function claimGuardParams(guard = {}) {
  return [
    guard.lockedBy ?? guard.locked_by ?? null,
    Number.parseInt(guard.attempts, 10) || null,
  ];
}

export async function markSucceeded(id, guard = {}, client = pool) {
  const [lockedBy, attempts] = claimGuardParams(guard);
  const { rows } = await client.query(
    `UPDATE job_queue
        SET status = 'succeeded',
            locked_at = NULL,
            locked_by = NULL,
            error = NULL,
            updated_at = NOW()
       WHERE id = $1
         AND status = 'running'
         AND locked_by IS NOT DISTINCT FROM $2
         AND attempts = $3
       RETURNING ${COLS}`,
    [id, lockedBy, attempts],
  );
  return shapeRow(rows[0]);
}

export async function markFailed(id, options = {}, client = pool) {
  const { error = null, runAfter = null } = options;
  const [lockedBy, attempts] = claimGuardParams(options);
  const { rows } = await client.query(
    `UPDATE job_queue
        SET status = 'failed',
            run_after = COALESCE($3::timestamptz, NOW()),
            locked_at = NULL,
            locked_by = NULL,
            error = $2,
            updated_at = NOW()
       WHERE id = $1
         AND status = 'running'
         AND locked_by IS NOT DISTINCT FROM $4
         AND attempts = $5
       RETURNING ${COLS}`,
    [id, error, runAfter, lockedBy, attempts],
  );
  return shapeRow(rows[0]);
}

export async function markDead(id, options = {}, client = pool) {
  const { error = null } = options;
  const [lockedBy, attempts] = claimGuardParams(options);
  const { rows } = await client.query(
    `UPDATE job_queue
        SET status = 'dead',
            locked_at = NULL,
            locked_by = NULL,
            error = $2,
            updated_at = NOW()
       WHERE id = $1
         AND status = 'running'
         AND locked_by IS NOT DISTINCT FROM $3
         AND attempts = $4
       RETURNING ${COLS}`,
    [id, error, lockedBy, attempts],
  );
  return shapeRow(rows[0]);
}

export async function rescueStuckJobs({ staleAfterMs = 10 * 60 * 1000, limit = 50 } = {}) {
  const cappedLimit = normalizeLimit(limit, 50, 250);
  const cappedStaleAfterMs = Math.max(Number.parseInt(staleAfterMs, 10) || 0, 1_000);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `WITH selected AS (
         SELECT id
           FROM job_queue
          WHERE status = 'running'
            AND locked_at IS NOT NULL
            AND locked_at < NOW() - ($1::int * INTERVAL '1 millisecond')
          ORDER BY locked_at ASC, id ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       UPDATE job_queue j
          SET status = CASE
                         WHEN j.attempts >= j.max_attempts THEN 'dead'
                         ELSE 'failed'
                       END,
              run_after = NOW(),
              locked_at = NULL,
              locked_by = NULL,
              error = COALESCE(j.error, 'Rescued stale running job lock'),
              updated_at = NOW()
         FROM selected s
        WHERE j.id = s.id
        RETURNING ${TARGET_COLS}`,
      [cappedStaleAfterMs, cappedLimit],
    );
    return rows.map(shapeRow);
  });
}

export async function countByStatus(client = pool) {
  const { rows } = await client.query(
    `SELECT status, COUNT(*)::int AS count
       FROM job_queue
      GROUP BY status`,
  );
  return rows.reduce((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});
}
