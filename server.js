import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'crypto';
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
import dataRouter from './routes/data.js';
import exportRouter from './routes/export.js';
import auditRouter from './routes/audit.js';
import bankHolidaysRouter from './routes/bankHolidays.js';
import handoverRouter from './routes/handover.js';
import payrollRouter  from './routes/payroll.js';
import gdprRouter     from './routes/gdpr.js';
import hrRouter       from './routes/hr.js';
import financeRouter  from './routes/finance.js';
import { accessLog } from './middleware/accessLog.js';
import { loadDenyList, pruneDenyList } from './services/authService.js';

const app = express();

// ── Security middleware ───────────────────────────────────────────────────────

app.use(helmet());
app.use(cors({ origin: config.allowedOrigin }));
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
app.use('/api/data', dataRouter);
app.use('/api/export', exportRouter);
app.use('/api/audit', auditRouter);
app.use('/api/bank-holidays', bankHolidaysRouter);
app.use('/api/handover', handoverRouter);
app.use('/api/payroll',  payrollRouter);
app.use('/api/gdpr',     gdprRouter);
app.use('/api/hr',       hrRouter);
app.use('/api/finance',  financeRouter);

// Health check — intentionally public (Docker/load balancer probe)
app.get('/health', async (req, res) => {
  let dbOk = false;
  try { await pool.query('SELECT 1'); dbOk = true; } catch {}
  const status = dbOk ? 200 : 503;
  res.status(status).json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'error',
    uptime: Math.round(process.uptime()),
  });
});

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

const server = app.listen(config.port, async () => {
  logger.info({ port: config.port, origin: config.allowedOrigin }, 'server started');
  // Load token deny-list into memory (non-blocking, non-fatal)
  await loadDenyList().catch(() => {});
  // Prune expired deny-list entries daily
  setInterval(
    () => pruneDenyList().catch(err => logger.warn({ err: err?.message }, 'deny-list prune failed')),
    24 * 60 * 60 * 1000
  ).unref();
});

// Graceful shutdown — drain in-flight requests then close DB pool
function shutdown(signal) {
  logger.info({ signal }, 'shutdown signal received');
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
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
  if (config.sentryDsn) Sentry.captureException(reason);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  if (config.sentryDsn) Sentry.captureException(err);
  shutdown('uncaughtException');
});
