import { pool } from '../db.js';
import { encrypt, decrypt } from '../services/encryptionService.js';

const SAFE_COLS = 'id, home_id, url, events, active, created_at, updated_at';

// Columns needed to decrypt the secret for outbound signing
const SECRET_COLS = 'id, home_id, url, events, active, secret, secret_encrypted, secret_iv, secret_tag';

/**
 * Resolve the plaintext secret from a webhook row.
 * Handles three states:
 *   1. Encrypted (secret_encrypted non-null) — decrypt and return
 *   2. Legacy plaintext (secret non-null, secret_encrypted null) — return as-is
 *   3. Neither — return null
 */
function resolveSecret(row) {
  if (row.secret_encrypted && row.secret_encrypted.length > 0) {
    // Buffer columns from pg driver are already Buffers
    return decrypt(row.secret_encrypted, row.secret_iv, row.secret_tag);
  }
  // Fallback: pre-migration plaintext secret still in the column
  return row.secret || null;
}

/**
 * Return only non-secret columns from a webhook row.
 */
function toSafeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    home_id: row.home_id,
    url: row.url,
    events: row.events,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function findByHome(homeId) {
  const { rows } = await pool.query(
    `SELECT ${SAFE_COLS} FROM webhooks WHERE home_id = $1 ORDER BY created_at DESC`,
    [homeId]
  );
  return rows;
}

export async function findById(id, homeId) {
  const { rows } = await pool.query(
    `SELECT ${SAFE_COLS} FROM webhooks WHERE id = $1 AND home_id = $2`,
    [id, homeId]
  );
  return rows[0] || null;
}

export async function findActiveByEvent(homeId, event) {
  const { rows } = await pool.query(
    `SELECT ${SECRET_COLS} FROM webhooks WHERE home_id = $1 AND active = true AND $2 = ANY(events)`,
    [homeId, event]
  );
  return rows.map(row => ({
    ...toSafeRow(row),
    secret: resolveSecret(row),
  }));
}

export async function create(homeId, data) {
  const { encrypted: ciphertext, iv, tag } = encrypt(data.secret);
  const { rows } = await pool.query(
    `INSERT INTO webhooks (home_id, url, secret_encrypted, secret_iv, secret_tag, events, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${SAFE_COLS}`,
    [homeId, data.url, ciphertext, iv, tag, data.events, data.active !== false]
  );
  return rows[0];
}

export async function update(id, homeId, data) {
  const { encrypted: ciphertext, iv, tag } = encrypt(data.secret);
  const { rows } = await pool.query(
    `UPDATE webhooks
     SET url = $3, secret_encrypted = $4, secret_iv = $5, secret_tag = $6,
         secret = NULL, events = $7, active = $8, updated_at = NOW()
     WHERE id = $1 AND home_id = $2
     RETURNING ${SAFE_COLS}`,
    [id, homeId, data.url, ciphertext, iv, tag, data.events, data.active]
  );
  return rows[0] || null;
}

export async function remove(id, homeId) {
  const { rowCount } = await pool.query(
    'DELETE FROM webhooks WHERE id = $1 AND home_id = $2',
    [id, homeId]
  );
  return rowCount > 0;
}

export async function logDelivery(webhookId, event, payload, statusCode, responseMs, error) {
  await pool.query(
    `INSERT INTO webhook_deliveries (webhook_id, event, payload, status_code, response_ms, error)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [webhookId, event, payload, statusCode, responseMs, error]
  );
}

export async function getRecentDeliveries(webhookId, homeId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT wd.id, wd.webhook_id, wd.event, wd.payload, wd.status_code,
            wd.response_ms, wd.error, wd.delivered_at
     FROM webhook_deliveries wd
     JOIN webhooks w ON w.id = wd.webhook_id
     WHERE wd.webhook_id = $1 AND w.home_id = $2
     ORDER BY wd.delivered_at DESC
     LIMIT $3`,
    [webhookId, homeId, limit]
  );
  return rows;
}
