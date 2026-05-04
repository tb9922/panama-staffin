import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { pool } from '../db.js';

const execFileAsync = promisify(execFile);

const STATUS_RANK = {
  ok: 0,
  warning: 1,
  error: 2,
};

function highestStatus(statuses) {
  return statuses.reduce((worst, status) => (
    (STATUS_RANK[status] ?? 0) > (STATUS_RANK[worst] ?? 0) ? status : worst
  ), 'ok');
}

function withTimeout(promise, ms, message = 'Timed out') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function getGitSha() {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try {
    const { stdout } = await withTimeout(
      execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: process.cwd(),
        windowsHide: true,
        maxBuffer: 64 * 1024,
      }),
      1000,
      'git lookup timed out',
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getDatabaseStatus() {
  try {
    const startedAt = Date.now();
    const { rows: [row] } = await withTimeout(pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM homes WHERE deleted_at IS NULL) AS active_homes,
         (SELECT COUNT(*)::int FROM users WHERE active = true) AS active_users,
         current_database() AS database_name`,
    ), 2000, 'database status timed out');
    return {
      status: 'ok',
      latency_ms: Date.now() - startedAt,
      database_name: row?.database_name || null,
      active_homes: row?.active_homes ?? null,
      active_users: row?.active_users ?? null,
      pool: {
        max: config.db.poolMax,
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
    };
  } catch (err) {
    return {
      status: 'error',
      error: err.message || 'Database status unavailable',
      pool: {
        max: config.db.poolMax,
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
    };
  }
}

async function getJobQueueStatus() {
  try {
    const exists = await withTimeout(
      pool.query(`SELECT to_regclass('public.job_queue') AS table_name`),
      1500,
      'job queue lookup timed out',
    );
    if (!exists.rows[0]?.table_name) {
      return {
        status: 'warning',
        available: false,
        message: 'Job queue table is not installed yet',
      };
    }

    const { rows } = await withTimeout(pool.query(
      `SELECT status, COUNT(*)::int AS count
         FROM job_queue
        GROUP BY status
        ORDER BY status`,
    ), 1500, 'job queue status timed out');
    const byStatus = Object.fromEntries(rows.map(row => [row.status, row.count]));
    const failed = Number(byStatus.failed || 0) + Number(byStatus.dead || 0);
    return {
      status: failed > 0 ? 'warning' : 'ok',
      available: true,
      by_status: byStatus,
      failed_jobs: failed,
    };
  } catch (err) {
    return {
      status: 'warning',
      available: false,
      message: err.message || 'Job queue status unavailable',
    };
  }
}

function getUploadScannerStatus() {
  const configured = Boolean(config.upload.scanCommand);
  const commandName = configured ? path.basename(config.upload.scanCommand) : null;
  return {
    status: configured ? 'ok' : 'warning',
    configured,
    command: commandName,
    timeout_ms: config.upload.scanTimeoutMs,
    fail_closed_in_production: config.nodeEnv === 'production',
  };
}

function getRuntimeStatus(git_sha) {
  const memory = process.memoryUsage();
  return {
    status: 'ok',
    environment: config.nodeEnv,
    node_version: process.version,
    platform: `${os.platform()} ${os.release()}`,
    uptime_seconds: Math.round(process.uptime()),
    git_sha,
    pid: process.pid,
    memory_mb: {
      rss: Math.round(memory.rss / 1024 / 1024),
      heap_used: Math.round(memory.heapUsed / 1024 / 1024),
      heap_total: Math.round(memory.heapTotal / 1024 / 1024),
    },
  };
}

function getSecurityConfigStatus() {
  return {
    status: config.metricsToken && config.allowedOrigin !== '*' ? 'ok' : 'warning',
    allowed_origin_configured: Boolean(config.allowedOrigin),
    metrics_endpoint_protected: Boolean(config.metricsToken),
    trust_proxy: Boolean(config.trustProxy),
    staff_portal_enabled: Boolean(config.enableStaffPortal),
    sentry_enabled: Boolean(config.sentryDsn),
  };
}

export async function getOpsStatus() {
  const [git_sha, database, jobs] = await Promise.all([
    getGitSha(),
    getDatabaseStatus(),
    getJobQueueStatus(),
  ]);
  const runtime = getRuntimeStatus(git_sha);
  const upload_scanner = getUploadScannerStatus();
  const security = getSecurityConfigStatus();
  const overall = highestStatus([
    runtime.status,
    database.status,
    jobs.status,
    upload_scanner.status,
    security.status,
  ]);

  return {
    generated_at: new Date().toISOString(),
    overall,
    runtime,
    database,
    jobs,
    upload_scanner,
    security,
  };
}

export const __test = {
  highestStatus,
  getUploadScannerStatus,
};
