import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { getHttpErrorResponse } from './errors.js';
import { pool } from './db.js';
import logger from './logger.js';
import { metricsContentType, recordHttpRequestMetrics, renderMetrics } from './metrics.js';
import { runWithRequestContext } from './requestContext.js';
import { scrubSentryEvent } from './shared/sentryScrubber.js';

if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    tracesSampleRate: config.sentryTracesSampleRate,
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubSentryEvent(event);
    },
  });
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
import cqcEvidenceLinksRouter from './routes/cqcEvidenceLinks.js';
import trainingRouter from './routes/training.js';
import careCertRouter from './routes/careCert.js';
import onboardingRouter from './routes/onboarding.js';
import staffAuthRouter from './routes/staffAuth.js';
import staffPortalRouter from './routes/staffPortal.js';
import clockInRouter from './routes/clockIn.js';
import evidenceHubRouter from './routes/evidenceHub.js';
import notificationsRouter from './routes/notifications.js';
import recordAttachmentsRouter from './routes/recordAttachments.js';
import staffRouter from './routes/staff.js';
import schedulingRouter from './routes/scheduling.js';
import usersRouter from './routes/users.js';
import bedsRouter from './routes/beds.js';
import platformRouter from './routes/platform.js';
import webhookRouter from './routes/webhooks.js';
import assessmentRouter from './routes/assessment.js';
import ropaRouter from './routes/ropa.js';
import dpiaRouter from './routes/dpia.js';
import importRouter from './routes/import.js';
import { accessLog } from './middleware/accessLog.js';
import { loadDenyList, pruneDenyList } from './services/authService.js';
import { ensureSeedUsers } from './services/userService.js';
import { purgeOlderThan as purgeAuditLog } from './services/auditService.js';
import {
  migrateAllLegacySecrets as migrateLegacyWebhookSecrets,
  purgeDeliveriesOlderThan as purgeWebhookDeliveries,
} from './repositories/webhookRepo.js';
import { processRetries as processWebhookRetries } from './services/webhookService.js';

const app = express();

// Ensure uploads directory exists on startup (prevents ENOENT on first file upload)
try { fs.mkdirSync(config.upload.dir, { recursive: true }); } catch { /* non-fatal */ }

// Trust first proxy (nginx) so req.ip reflects the real client IP.
// Without this, rate limiters use 127.0.0.1 for everyone behind a proxy.
app.set('trust proxy', config.trustProxy ? 1 : false);

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
  runWithRequestContext({ reqId: req.id }, () => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      recordHttpRequestMetrics(req, res, ms);
      logger.info({ method: req.method, url: req.url, status: res.statusCode, ms }, 'request');
    });
    next();
  });
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
app.use('/api/cqc-evidence-links', cqcEvidenceLinksRouter);
app.use('/api/training', trainingRouter);
app.use('/api/care-cert', careCertRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/staff-auth', staffAuthRouter);
app.use('/api/me', staffPortalRouter);
app.use('/api/clock-in', clockInRouter);
app.use('/api/evidence-hub', evidenceHubRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/record-attachments', recordAttachmentsRouter);
app.use('/api/staff', staffRouter);
app.use('/api/scheduling', schedulingRouter);
app.use('/api/users', usersRouter);
app.use('/api/beds', bedsRouter);
app.use('/api/platform', platformRouter);
app.use('/api/webhooks', webhookRouter);
app.use('/api/assessment', assessmentRouter);
app.use('/api/ropa', ropaRouter);
app.use('/api/dpia', dpiaRouter);
app.use('/api/import', importRouter);

// Readiness probe — returns 503 during graceful shutdown (for load balancer drain)
let shuttingDown = false;
app.get('/readiness', async (req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'shutting_down' });
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    res.json({ status: 'ready', db: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'error' });
  }
});

// Health check — intentionally public (Docker/load balancer probe)
app.get('/health', async (req, res) => {
  let dbOk = false;
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    dbOk = true;
  } catch { /* db down or timeout */ }
  res.setHeader('Cache-Control', 'no-store');
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'error',
  });
});

app.get('/metrics', async (req, res) => {
  if (!config.metricsToken) {
    return res.status(404).send('Not found');
  }
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${config.metricsToken}`) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  const body = await renderMetrics();
  res.set('Content-Type', metricsContentType());
  res.send(body);
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
  app.get('/{*splat}', (req, res) => {
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
  const httpError = getHttpErrorResponse(err);
  if (httpError) {
    if (httpError.statusCode >= 500) {
      logger.error({ reqId: req.id, err: httpError.message, code: httpError.code }, 'server error');
    } else {
      logger.warn({ reqId: req.id, err: httpError.message, code: httpError.code, status: httpError.statusCode }, 'client error');
    }
    return res.status(httpError.statusCode).json({ error: httpError.message });
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

// Start the HTTP server for normal execution, including PM2 workers.
// Tests import the app object directly and should not bind a port.
const isDirectRun = Boolean(process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')));
const isPm2Process = process.env.pm_id != null || process.env.NODE_APP_INSTANCE != null;
const isTestProcess = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
const isPlaywrightWebServer = process.env.PANAMA_E2E_SERVER === '1';
const shouldListen = isPlaywrightWebServer || (!isTestProcess && (isDirectRun || isPm2Process));
const server = shouldListen ? app.listen(config.port, async () => {
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
  await migrateLegacyWebhookSecrets().then((migrated) => {
    if (migrated > 0) {
      logger.info({ migrated }, 'Migrated legacy plaintext webhook secrets');
    }
  }).catch(err =>
    logger.warn({ err: err?.message }, 'Webhook secret migration skipped')
  );
  // Background cron jobs — only run on instance 0 in cluster mode.
  // PM2 sets NODE_APP_INSTANCE for each worker; without it (fork mode / dev), run on all.
  if (!process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0') {
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
    if (!config.enableWebhookRetryWorker) {
      // Purge webhook delivery logs past 90-day retention daily
      setInterval(
        () => purgeWebhookDeliveries(90).catch(err => logger.warn({ err: err?.message }, 'webhook delivery purge failed')),
        24 * 60 * 60 * 1000
      ).unref();
      // Process webhook retries every 30 seconds
      setInterval(
        () => processWebhookRetries().catch(err => logger.warn({ err: err?.message }, 'webhook retry processing failed')),
        30_000
      ).unref();
    }
    logger.info('Background jobs registered (instance 0)');
  }
}) : null;

// Graceful shutdown — drain in-flight requests then close DB pool
function shutdown(signal) {
  logger.info({ signal }, 'shutdown signal received');
  shuttingDown = true;
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
  shuttingDown = true;
  if (server) {
    try { server.close(); } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(1), 250).unref();
});
