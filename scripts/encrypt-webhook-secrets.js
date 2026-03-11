#!/usr/bin/env node

/**
 * One-time backfill: encrypt existing plaintext webhook secrets.
 *
 * Reads all webhooks where `secret` is non-null (plaintext), encrypts each
 * secret using AES-256-GCM, stores the ciphertext in secret_encrypted/iv/tag,
 * and NULLs out the plaintext column.
 *
 * Prerequisites:
 *   - Migration 100 has been applied (adds secret_encrypted/iv/tag columns)
 *   - ENCRYPTION_KEY env var is set (64 hex chars = 32 bytes)
 *
 * Usage:
 *   node scripts/encrypt-webhook-secrets.js              # dry run (default)
 *   node scripts/encrypt-webhook-secrets.js --execute    # actually encrypt
 *
 * Safety:
 *   - Dry run by default — shows what would be encrypted
 *   - Each webhook is updated in its own transaction
 *   - Plaintext is only NULLed after encrypted columns are written
 */

import { pool } from '../db.js';
import { encrypt } from '../services/encryptionService.js';

const DRY_RUN = !process.argv.includes('--execute');

async function run() {
  const mode = DRY_RUN ? 'DRY RUN' : 'EXECUTE';
  console.log(`[${new Date().toISOString()}] Webhook secret encryption backfill (${mode})`);
  console.log('');

  // Find all webhooks that still have plaintext secrets
  const { rows } = await pool.query(
    'SELECT id, home_id FROM webhooks WHERE secret IS NOT NULL'
  );

  if (rows.length === 0) {
    console.log('  No plaintext secrets found — nothing to do.');
    await pool.end();
    return;
  }

  console.log(`  Found ${rows.length} webhook(s) with plaintext secrets.`);
  let encrypted = 0;
  let errors = 0;

  for (const row of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock and read the plaintext secret
      const { rows: [webhook] } = await client.query(
        'SELECT id, secret FROM webhooks WHERE id = $1 AND secret IS NOT NULL FOR UPDATE',
        [row.id]
      );

      if (!webhook) {
        // Already encrypted by another run or concurrent process
        await client.query('ROLLBACK');
        continue;
      }

      if (DRY_RUN) {
        console.log(`  Webhook ${webhook.id} (home ${row.home_id}): would encrypt`);
        encrypted++;
        await client.query('ROLLBACK');
        continue;
      }

      const { encrypted: ciphertext, iv, tag } = encrypt(webhook.secret);

      await client.query(
        `UPDATE webhooks
         SET secret_encrypted = $2, secret_iv = $3, secret_tag = $4, secret = NULL, updated_at = NOW()
         WHERE id = $1`,
        [webhook.id, ciphertext, iv, tag]
      );

      await client.query('COMMIT');
      encrypted++;
      console.log(`  Webhook ${webhook.id} (home ${row.home_id}): encrypted`);
    } catch (err) {
      await client.query('ROLLBACK');
      errors++;
      console.error(`  Webhook ${row.id}: ERROR — ${err.message}`);
    } finally {
      client.release();
    }
  }

  console.log('');
  console.log(`[${new Date().toISOString()}] ${mode} complete: ${encrypted} encrypted, ${errors} errors`);

  await pool.end();
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
