#!/usr/bin/env node
/**
 * Reset a user's password and clear any account lockout.
 *
 * Usage:
 *   node scripts/reset-password.js admin NewPassword1
 *   node scripts/reset-password.js viewer ViewerPass1
 *
 * Password requirements: 10+ chars, uppercase, lowercase, number.
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.error('Usage: node scripts/reset-password.js <username> <password>');
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
  password: process.env.DB_PASSWORD || 'panama_dev_secret',
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
