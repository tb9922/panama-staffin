/**
 * Centralized server configuration.
 *
 * Loads .env on startup, then validates that every required environment
 * variable is present. The server refuses to start if any are missing.
 *
 * All process.env reads live here. Everywhere else in the server imports
 * from this module rather than reading process.env directly.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env manually. Variables already set by the host are never overwritten.
try {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    const val = raw.replace(/^(['"])(.*)\1$/, '$2');
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch {
  // .env is optional in production where env vars are injected externally.
}

function parseIntEnv(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatEnv(value, fallback) {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Missing any of these is a fatal startup error.
const REQUIRED_VARS = ['JWT_SECRET', 'DB_PASSWORD', 'ALLOWED_ORIGIN'];
const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
  console.error('See .env.example for required configuration.');
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be at least 32 characters for adequate entropy');
  process.exit(1);
}

if (process.env.ALLOWED_ORIGIN === '*') {
  console.error('FATAL: ALLOWED_ORIGIN=* is not permitted because it would expose protected endpoints');
  process.exit(1);
}

// ENCRYPTION_KEY is optional, but if set it must be exactly 64 hex characters.
if (process.env.ENCRYPTION_KEY) {
  const validHex = /^[0-9a-fA-F]+$/.test(process.env.ENCRYPTION_KEY);
  if (process.env.ENCRYPTION_KEY.length !== 64 || !validHex) {
    console.error('FATAL: ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256-GCM).');
    console.error(`Got ${process.env.ENCRYPTION_KEY.length} characters.`);
    console.error('Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }
}

export const config = {
  // Server
  port: parseIntEnv(process.env.PORT, 3001),
  host: process.env.HOST || '0.0.0.0',
  sentryDsn: process.env.SENTRY_DSN || null,
  sentryTracesSampleRate: parseFloatEnv(process.env.SENTRY_TRACES_SAMPLE_RATE, 0),
  allowedOrigin: process.env.ALLOWED_ORIGIN,
  nodeEnv: process.env.NODE_ENV || 'development',
  trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production',
  logLevel: process.env.LOG_LEVEL || 'info',
  metricsToken: process.env.METRICS_TOKEN || null,
  enableWebhookRetryWorker: process.env.ENABLE_WEBHOOK_RETRY_WORKER === '1' || process.env.ENABLE_WEBHOOK_RETRY_WORKER === 'true',

  // Authentication
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '4h',
  enableStaffPortal: process.env.ENABLE_STAFF_PORTAL === '1' || process.env.VITEST === 'true',

  // Env-var users are a temporary fallback for pre-migration compatibility.
  users: [
    process.env.ADMIN_PASSWORD_HASH
      ? { username: 'admin', hash: process.env.ADMIN_PASSWORD_HASH, role: 'admin' }
      : null,
    process.env.VIEWER_PASSWORD_HASH
      ? { username: 'viewer', hash: process.env.VIEWER_PASSWORD_HASH, role: 'viewer' }
      : null,
  ].filter(Boolean),

  // Paths
  dataDir: path.join(__dirname, 'homes'),
  backupDir: path.join(__dirname, 'backups'),
  auditFile: path.join(__dirname, 'audit_log.json'),
  legacyFile: path.join(__dirname, 'staffing_data.json'),

  // Data management
  backupRetentionCount: 20,
  auditLogMaxEntries: 500,
  requestBodyLimit: '1mb',

  // Database
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseIntEnv(process.env.DB_PORT, 5432),
    name: process.env.DB_NAME || 'panama_dev',
    user: process.env.DB_USER || 'panama',
    password: process.env.DB_PASSWORD,
    poolMax: parseIntEnv(process.env.DB_POOL_MAX, 15),
    idleTimeoutMs: parseIntEnv(process.env.DB_POOL_IDLE_TIMEOUT, 30000),
    connectionTimeoutMs: parseIntEnv(process.env.DB_POOL_CONNECT_TIMEOUT, 5000),
    idleInTransactionTimeoutMs: parseIntEnv(process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS, 60000),
    ssl: process.env.DB_SSL === 'false'
      ? false
      : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' },
  },

  // File uploads
  upload: {
    dir: path.join(__dirname, 'uploads'),
    maxFileSize: 20 * 1024 * 1024,
    allowedMimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/rtf',
      'text/rtf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      'text/plain',
    ],
  },

  ocr: {
    paddleUrl: process.env.PADDLE_OCR_URL || null,
    timeoutMs: parseIntEnv(process.env.PADDLE_OCR_TIMEOUT_MS, 30000),
  },
};

if (config.nodeEnv === 'production' && config.ocr.paddleUrl) {
  let paddleUrl;
  try {
    paddleUrl = new URL(config.ocr.paddleUrl);
  } catch {
    console.error('FATAL: PADDLE_OCR_URL must be a valid URL');
    process.exit(1);
  }
  if (paddleUrl.protocol !== 'https:') {
    console.error('FATAL: PADDLE_OCR_URL must use https in production');
    process.exit(1);
  }
}
