import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { AppError } from './errors.js';
import { pool } from './db.js';
import logger from './logger.js';

if (config.sentryDsn) {
  Sentry.init({ dsn: config.sentryDsn, environment: config.nodeEnv });
  logger.info('Sentry error tracking enabled');
}
import authRouter from './routes/auth.js';
import homesRouter from './routes/homes.js';
import dashboardRouter from './routes/dashboard.js';
import dataRouter from './routes/data.js';
import exportRouter from './routes/export.js';
import auditRouter from './routes/audit.js';
import bankHolidaysRouter from './routes/bankHolidays.js';
import handoverRouter from './routes/handover.js';
import payrollRouter  from './routes/payroll.js';
import gdprRouter     from './routes/gdpr.js';
import hrRouter       from './routes/hr.js';
import financeRouter  from './routes/finance.js';
import incidentsRouter from './routes/incidents.js';
import complaintsRouter from './routes/complaints.js';
import maintenanceRouter from './routes/maintenance.js';
import ipcRouter from './routes/ipc.js';
import riskRegisterRouter from './routes/riskRegister.js';
import policiesRouter from './routes/policies.js';
import whistleblowingRouter from './routes/whistleblowing.js';
import dolsRouter from './routes/dols.js';
import cqcEvidenceRouter from './routes/cqcEvidence.js';
import trainingRouter from './routes/training.js';
import careCertRouter from './routes/careCert.js';
import onboardingRouter from './routes/onboarding.js';
import staffRouter from './routes/staff.js';
import schedulingRouter from './routes/scheduling.js';
import usersRouter from './routes/users.js';
import bedsRouter from './routes/beds.js';
import platformRouter from './routes/platform.js';
import webhookRouter from './routes/webhooks.js';
import importRouter from './routes/import.js';
import { accessLog } from './middleware/accessLog.js';
import { loadDenyList, pruneDenyList } from './services/authService.js';
import { ensureSeedUsers } from './services/userService.js';
import { purgeOlderThan as purgeAuditLog } from './services/auditService.js';

const app = express();

// Trust first proxy (nginx) so req.ip reflects the real client IP.
// Without this, rate limiters use 127.0.0.1 for everyone behind a proxy.
if (config.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

// ── Security middleware ───────────────────────────────────────────────────────

app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: false,  // CSP handled by nginx in production
}));
app.use(cors({ origin: config.allowedOrigin, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: config.requestBodyLimit }));

// ── Request ID + structured request logging ───────────────────────────────────

app.use((req, res, next) => {
  req.id = randomUUID();
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    logger.info({ reqId: req.id, method: req.method, url: req.url, status: res.statusCode, ms }, 'request');
  });
  next();
});

// ── Access logging (fire-and-forget — never blocks responses) ─────────────────

app.use(accessLog);

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api/login', authRouter);
app.use('/api/homes', homesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/data', dataRouter);
app.use('/api/export', exportRouter);
app.use('/api/audit', auditRouter);
app.use('/api/bank-holidays', bankHolidaysRouter);
app.use('/api/handover', handoverRouter);
app.use('/api/payroll',  payrollRouter);
app.use('/api/gdpr',     gdprRouter);
app.use('/api/hr',       hrRouter);
app.use('/api/finance',  financeRouter);
app.use('/api/incidents', incidentsRouter);
app.use('/api/complaints', complaintsRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/ipc', ipcRouter);
app.use('/api/risk-register', riskRegisterRouter);
app.use('/api/policies', policiesRouter);
app.use('/api/whistleblowing', whistleblowingRouter);
app.use('/api/dols', dolsRouter);
app.use('/api/cqc-evidence', cqcEvidenceRouter);
app.use('/api/training', trainingRouter);
app.use('/api/care-cert', careCertRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/staff', staffRouter);
app.use('/api/scheduling', schedulingRouter);
app.use('/api/users', usersRouter);
app.use('/api/beds', bedsRouter);
app.use('/api/platform', platformRouter);
app.use('/api/webhooks', webhookRouter);
app.use('/api/import', importRouter);

// Health check — intentionally public (Docker/load balancer probe)
app.get('/health', async (req, res) => {
  let dbOk = false;
  let queryMs = null;
  let migrationVersion = null;
  try {
    const start = Date.now();
    const [, mv] = await Promise.race([
      Promise.all([pool.query('SELECT 1'), pool.query('SELECT MAX(id) AS v FROM migrations')]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    queryMs = Date.now() - start;
    dbOk = true;
    migrationVersion = mv.rows[0]?.v ?? null;
  } catch { /* db down or timeout */ }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'error',
    queryMs,
    migrationVersion,
    pool: {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    },
  });
});

// 404 catch-all for unmatched API routes (SPA routes fall through to index.html)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Production SPA serving ────────────────────────────────────────────────────
// In production, serve the built React app from dist/.
// In dev, Vite dev server handles this on :5173.
if (config.nodeEnv === 'production') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.join(__dirname, 'dist');
  app.use(express.static(distDir, {
    maxAge: '1y',
    immutable: true,
    setHeaders(res, filePath) {
      // index.html is NOT content-hashed — must not be cached long-term
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// Sentry error handler — must be after routes, before custom error handler
if (config.sentryDsn) Sentry.setupExpressErrorHandler(app);

// ── Global error handler ──────────────────────────────────────────────────────
// Must be registered after all routes. Express identifies it by the 4-arg signature.
// AppError subclasses map to their own status codes. Unexpected errors become 500.
// Stack traces logged server-side, never sent to client.

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ reqId: req.id, err: err.message, code: err.code }, 'server error');
    } else {
      logger.warn({ reqId: req.id, err: err.message, code: err.code, status: err.statusCode }, 'client error');
    }
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err?.name === 'ZodError') {
    const message = err.issues?.[0]?.message || 'Invalid request';
    logger.warn({ reqId: req.id, err: message }, 'validation error');
    return res.status(400).json({ error: message });
  }

  logger.error({ reqId: req.id, err: err?.message, stack: err?.stack }, 'unhandled error');
  if (config.sentryDsn) Sentry.captureException(err);
  res.status(500).json({ error: 'An unexpected error occurred' });
});

// ── Server startup ────────────────────────────────────────────────────────────

// Export app for testing (supertest)
export { app };

// Only listen when run directly (not when imported by tests)
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
const server = isMainModule ? app.listen(config.port, async () => {
  // Request + connection timeouts
  server.setTimeout(30000);        // 30s max request duration
  server.keepAliveTimeout = 65000; // slightly above typical LB idle (60s)
  server.headersTimeout = 66000;   // must exceed keepAliveTimeout
  logger.info({ port: config.port, origin: config.allowedOrigin }, 'server started');
  // Load token deny-list into memory (non-blocking, non-fatal)
  await loadDenyList().catch(err =>
    logger.error({ err: err?.message }, 'Failed to load token deny list — revoked tokens may be accepted')
  );
  // Seed database users from env vars on first run (non-fatal)
  await ensureSeedUsers().catch(err =>
    logger.warn({ err: err?.message }, 'User seeding skipped')
  );
  // Prune expired deny-list entries hourly
  setInterval(
    () => pruneDenyList().catch(err => logger.warn({ err: err?.message }, 'deny-list prune failed')),
    60 * 60 * 1000
  ).unref();
  // Purge audit entries past 7-year retention daily
  setInterval(
    () => purgeAuditLog(2555).catch(err => logger.warn({ err: err?.message }, 'audit purge failed')),
    24 * 60 * 60 * 1000
  ).unref();
}) : null;

// Graceful shutdown — drain in-flight requests then close DB pool
function shutdown(signal) {
  logger.info({ signal }, 'shutdown signal received');
  if (!server) { process.exit(0); return; }
  server.close(async () => {
    logger.info('HTTP server closed');
    await pool.end();
    process.exit(0);
  });
  // Force exit after 5 seconds if connections don't drain
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Catch unhandled promise rejections — without this, Node silently crashes
process.on('unhandledRejection', (reason, _promise) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
  if (config.sentryDsn) Sentry.captureException(reason);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  if (config.sentryDsn) Sentry.captureException(err);
  shutdown('uncaughtException');
});
