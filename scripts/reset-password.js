#!/usr/bin/env node
/**
 * Reset a user's password and clear any account lockout.
 *
 * Usage:
 *   RESET_PASSWORD='NewPassword1' node scripts/reset-password.js admin
 *   echo 'NewPassword1' | node scripts/reset-password.js viewer
 *
 * Password requirements: 10+ chars, uppercase, lowercase, number.
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';

const { Pool } = pg;

const username = process.argv[2];
let password = process.env.RESET_PASSWORD || '';
if (!password && !process.stdin.isTTY) {
  password = readFileSync(0, 'utf8').trim();
}

if (!username || !password) {
  console.error('Usage: RESET_PASSWORD=<password> node scripts/reset-password.js <username>');
  console.error('   or: echo <password> | node scripts/reset-password.js <username>');
  process.exit(1);
}

if (process.argv[3]) {
  console.error('Refusing password via argv because it can leak through shell history and process lists.');
  process.exit(1);
}

if (!process.env.DB_PASSWORD) {
  console.error('DB_PASSWORD is required');
  process.exit(1);
}

if (password.length < 10) { console.error('Password must be at least 10 characters'); process.exit(1); }
if (!/[A-Z]/.test(password)) { console.error('Password must contain an uppercase letter'); process.exit(1); }
if (!/[a-z]/.test(password)) { console.error('Password must contain a lowercase letter'); process.exit(1); }
if (!/[0-9]/.test(password)) { console.error('Password must contain a number'); process.exit(1); }

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'panama_dev',
  user: process.env.DB_USER || 'panama',
  password: process.env.DB_PASSWORD,
});

try {
  const { rows } = await pool.query('SELECT id, username FROM users WHERE username = $1', [username]);
  if (rows.length === 0) {
    console.error(`User "${username}" not found`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    'UPDATE users SET password_hash = $1, failed_login_count = 0, locked_until = NULL WHERE username = $2',
    [hash, username]
  );

  // Clear any deny-list entries so the user can log in immediately
  await pool.query("DELETE FROM token_denylist WHERE username = $1 AND scope = 'user'", [username]);

  console.log(`Password reset for "${username}" — lockout cleared, deny-list cleared.`);
} catch (err) {
  console.error('Failed:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
