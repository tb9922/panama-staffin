#!/usr/bin/env node
/**
 * Database migration runner.
 *
 * Usage: node scripts/migrate.js [--db <connection_string>]
 *
 * Options:
 *   --db <name>   Override database name (default: DB_NAME env var or 'panama_dev')
 *
 * Reads all .sql files from migrations/ in alphabetical order and runs any
 * that haven't been run yet. Tracks completed migrations in the `migrations`
 * table. Each migration runs in its own transaction — failure stops the run.
 * Safe to run multiple times (idempotent).
 *
 * NOTE: Rollback (--down) is not implemented. To roll back a migration,
 * apply the -- DOWN section manually via psql.
 */

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import pg from 'pg';

// Parse CLI args
const args = process.argv.slice(2);
const dbOverrideIdx = args.indexOf('--db');
const dbOverride = dbOverrideIdx !== -1 ? args[dbOverrideIdx + 1] : null;

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const MIGRATION_ALIASES = new Map([
  ['153_staff_unique_active_name_start.sql', ['124_staff_unique_active_name_start.sql']],
  ['154_create_onboarding_history.sql', ['133_create_onboarding_history.sql']],
]);

// Load .env manually (same logic as config.js — keeps scripts self-contained)
try {
  const envContent = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'),
    'utf-8'
  );
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
  // .env optional in environments where vars are injected
}

const { Pool } = pg;
const sslEnabled = (process.env.DB_SSL || 'true').toLowerCase() !== 'false';
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: dbOverride || process.env.DB_NAME || 'panama_dev',
  user:     process.env.DB_USER     || 'panama',
  password: process.env.DB_PASSWORD,
  ...(sslEnabled ? { ssl: { rejectUnauthorized: (process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false' } } : {}),
});

async function migrate() {
  const client = await pool.connect();
  try {
    // Acquire advisory lock to prevent concurrent migration runners
    await client.query('SELECT pg_advisory_lock(999999)');

    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id      SERIAL        PRIMARY KEY,
        name    VARCHAR(255)  NOT NULL UNIQUE,
        run_at  TIMESTAMP     NOT NULL DEFAULT NOW()
      )
    `);

    const { rows: completed } = await client.query('SELECT name FROM migrations ORDER BY name');
    const completedNames = new Set(completed.map(r => r.name));

    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const seenPrefixes = new Map();
    for (const file of files) {
      const match = file.match(/^(\d+)_/);
      if (!match) continue;
      const prefix = match[1];
      if (seenPrefixes.has(prefix)) {
        throw new Error(`Duplicate migration prefix ${prefix}: ${seenPrefixes.get(prefix)} and ${file}`);
      }
      seenPrefixes.set(prefix, file);
    }

    let ran = 0;
    for (const file of files) {
      const aliases = MIGRATION_ALIASES.get(file) || [];
      if (completedNames.has(file) || aliases.some(alias => completedNames.has(alias))) continue;

      const sql = readFileSync(path.join(migrationsDir, file), 'utf-8');
      // Extract everything before "-- DOWN" as the UP section
      const upSql = sql.split('-- DOWN')[0].replace(/^--\s*UP\s*\n?/m, '').trim();

      console.log(`  Running: ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(upSql);
        await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran++;
        console.log(`  ✓ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ✗ ${file}: ${err.message}`);
        throw err;
      }
    }

    if (ran === 0) {
      console.log('  No pending migrations.');
    } else {
      console.log(`\n  ${ran} migration${ran > 1 ? 's' : ''} applied.`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(999999)').catch(() => {});
    client.release();
    await pool.end();
  }
}

console.log(`\nRunning migrations on database: ${dbOverride || process.env.DB_NAME || 'panama_dev'}\n`);
migrate().catch(err => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
