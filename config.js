/**
 * Centralised server configuration.
 *
 * Loads .env on startup, then validates that every required environment
 * variable is present. The server refuses to start if any are missing —
 * a misconfigured server is worse than a server that won't start.
 *
 * All process.env reads live here. Everywhere else in the server imports
 * from this module rather than reading process.env directly.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env manually — no dotenv dependency. Variables already set in the
// environment (e.g. injected by the host) are never overwritten.
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
  // .env is optional in production where env vars are injected externally
}

// Required variables — missing any of these is a fatal startup error.
// Use console.error here; the logger hasn't been initialised yet.
const REQUIRED_VARS = ['JWT_SECRET', 'DB_PASSWORD', 'ALLOWED_ORIGIN'];
const missing = REQUIRED_VARS.filter(k => !process.env[k]);
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
  console.error('FATAL: ALLOWED_ORIGIN=* is not permitted — this would expose all endpoints including health records');
  process.exit(1);
}

// ENCRYPTION_KEY — optional (only required if webhooks with secrets are used), but if set
// it must be exactly 64 hex chars (32 bytes for AES-256-GCM). Catch format errors at
// startup rather than at first webhook delivery in production.
if (process.env.ENCRYPTION_KEY) {
  if (process.env.ENCRYPTION_KEY.length !== 64 || !/^[0-9a-fA-F]+$/.test(process.env.ENCRYPTION_KEY)) {
    console.error('FATAL: ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256-GCM).');
    console.error(`Got ${process.env.ENCRYPTION_KEY.length} characters.`);
    console.error('Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }
}

export const config = {
  // ── Server ──────────────────────────────────────────────────────────────────
  port: parseInt(process.env.PORT || '3001', 10),
  sentryDsn: process.env.SENTRY_DSN || null,  // optional — monitoring only
  allowedOrigin: process.env.ALLOWED_ORIGIN || 'http://localhost:5173',
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // ── Authentication ───────────────────────────────────────────────────────────
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: '4h',

  // Env-var users — fallback for pre-migration compatibility. Once the users
  // table is populated these are ignored. Can be removed after first deployment.
  users: [
    process.env.ADMIN_PASSWORD_HASH  ? { username: 'admin',  hash: process.env.ADMIN_PASSWORD_HASH,  role: 'admin' }  : null,
    process.env.VIEWER_PASSWORD_HASH ? { username: 'viewer', hash: process.env.VIEWER_PASSWORD_HASH, role: 'viewer' } : null,
  ].filter(Boolean),

  // ── Paths ────────────────────────────────────────────────────────────────────
  dataDir: path.join(__dirname, 'homes'),
  backupDir: path.join(__dirname, 'backups'),
  auditFile: path.join(__dirname, 'audit_log.json'),
  legacyFile: path.join(__dirname, 'staffing_data.json'),

  // ── Data management ──────────────────────────────────────────────────────────
  backupRetentionCount: 20,
  auditLogMaxEntries: 500,
  requestBodyLimit: '1mb',

  // ── Database ─────────────────────────────────────────────────────────────────
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'panama_dev',
    user: process.env.DB_USER || 'panama',
    password: process.env.DB_PASSWORD,
    poolMax: parseInt(process.env.DB_POOL_MAX || '30', 10),
    idleTimeoutMs: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
    connectionTimeoutMs: parseInt(process.env.DB_POOL_CONNECT_TIMEOUT || '5000', 10),
    ssl: process.env.DB_SSL === 'false'
      ? false
      : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' },
  },

  // ── File uploads ───────────────────────────────────────────────────────────
  upload: {
    dir: path.join(__dirname, 'uploads'),
    maxFileSize: 20 * 1024 * 1024, // 20MB
    allowedMimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'text/plain',
    ],
  },
};
