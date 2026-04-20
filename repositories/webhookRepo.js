import { pool, withTransaction } from '../db.js';
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
  if (row.signing_secret_encrypted && row.signing_secret_encrypted.length > 0) {
    return decrypt(row.signing_secret_encrypted, row.signing_secret_iv, row.signing_secret_tag);
  }
  if (row.secret_encrypted && row.secret_encrypted.length > 0) {
    // Buffer columns from pg driver are already Buffers
    return decrypt(row.secret_encrypted, row.secret_iv, row.secret_tag);
  }
  // Fallback: pre-migration plaintext secret still in the column
  return row.secret || null;
}

async function migrateLegacySecret(row, client) {
  if (!process.env.ENCRYPTION_KEY) return;
  if (!row?.secret || (row.secret_encrypted && row.secret_encrypted.length > 0)) return;
  const conn = client || pool;
  const { encrypted, iv, tag } = encrypt(row.secret);
  await conn.query(
    `UPDATE webhooks
     SET secret_encrypted = $2,
         secret_iv = $3,
         secret_tag = $4,
         secret = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND secret IS NOT NULL
       AND secret_encrypted IS NULL`,
    [row.id, encrypted, iv, tag],
  );
}

async function toRowWithSecret(row, client) {
  const secret = resolveSecret(row);
  if (row?.secret && (!row.secret_encrypted || row.secret_encrypted.length === 0)) {
    await migrateLegacySecret(row, client);
  }
  return {
    ...toSafeRow(row),
    secret,
  };
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
  return Promise.all(rows.map(row => toRowWithSecret(row)));
}

export async function migrateAllLegacySecrets(client = pool) {
  if (!process.env.ENCRYPTION_KEY) return 0;
  const { rows } = await client.query(
    `SELECT ${SECRET_COLS}
       FROM webhooks
      WHERE secret IS NOT NULL
        AND secret_encrypted IS NULL`
  );
  for (const row of rows) {
    await migrateLegacySecret(row, client);
  }
  return rows.length;
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

export async function logDelivery(webhookId, event, payload, statusCode, responseMs, error, status = 'delivered', options = {}) {
  let retryCount = 0;
  let nextRetryAt = null;
  let signingSecretEncrypted = null;
  let signingSecretIv = null;
  let signingSecretTag = null;
  if (typeof options.retryCount === 'number') retryCount = options.retryCount;
  if (options.nextRetryAt != null) nextRetryAt = options.nextRetryAt;
  if (options.signingSecret) {
    const { encrypted, iv, tag } = encrypt(options.signingSecret);
    signingSecretEncrypted = encrypted;
    signingSecretIv = iv;
    signingSecretTag = tag;
  }

  const { rows } = await pool.query(
    `INSERT INTO webhook_deliveries (
       webhook_id,
       event,
       payload,
       status_code,
       response_ms,
       error,
       status,
       retry_count,
       next_retry_at,
       signing_secret_encrypted,
       signing_secret_iv,
       signing_secret_tag
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      webhookId,
      event,
      payload,
      statusCode,
      responseMs,
      error,
      status,
      retryCount,
      nextRetryAt,
      signingSecretEncrypted,
      signingSecretIv,
      signingSecretTag,
    ]
  );
  return rows[0]?.id;
}

export async function findRecentDuplicateDelivery(
  webhookId,
  event,
  payload,
  statuses = ['delivered', 'pending_retry', 'in_progress'],
  windowMinutes = 5,
) {
  const { rows } = await pool.query(
    `SELECT id, status, delivered_at
     FROM webhook_deliveries
     WHERE webhook_id = $1
       AND event = $2
       AND (
         payload = $3::jsonb
         OR (
           jsonb_typeof(payload) = 'object'
           AND jsonb_typeof($3::jsonb) = 'object'
           AND (payload - 'timestamp') = ($3::jsonb - 'timestamp')
         )
       )
       AND status = ANY($4::text[])
       AND delivered_at >= NOW() - ($5::int * INTERVAL '1 minute')
     ORDER BY delivered_at DESC
     LIMIT 1`,
    [webhookId, event, payload, statuses, windowMinutes],
  );
  return rows[0] || null;
}

export async function purgeDeliveriesOlderThan(days, client) {
  const conn = client || pool;
  const { rowCount } = await conn.query(
    `DELETE FROM webhook_deliveries WHERE delivered_at < NOW() - INTERVAL '1 day' * $1`,
    [days]
  );
  return rowCount;
}

export async function getRecentDeliveries(webhookId, homeId, { limit = 50, status = null } = {}) {
  const params = [webhookId, homeId];
  let statusFilter = '';
  if (status) {
    params.push(status);
    statusFilter = ` AND wd.status = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT wd.id, wd.webhook_id, wd.event, wd.payload, wd.status_code,
            wd.response_ms, wd.error, wd.delivered_at,
            wd.retry_count, wd.next_retry_at, wd.status
     FROM webhook_deliveries wd
     JOIN webhooks w ON w.id = wd.webhook_id
     WHERE wd.webhook_id = $1 AND w.home_id = $2${statusFilter}
     ORDER BY wd.delivered_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function findPendingRetries(limit = 20) {
  const { rows } = await pool.query(
    `SELECT wd.id, wd.webhook_id, wd.event, wd.payload, wd.retry_count,
            wd.signing_secret_encrypted, wd.signing_secret_iv, wd.signing_secret_tag,
            w.url, w.secret, w.secret_encrypted, w.secret_iv, w.secret_tag,
            w.home_id, w.active
     FROM webhook_deliveries wd
     JOIN webhooks w ON w.id = wd.webhook_id
     WHERE wd.status = 'pending_retry' AND wd.next_retry_at <= NOW()
     ORDER BY wd.next_retry_at ASC
     LIMIT $1
     FOR UPDATE OF wd SKIP LOCKED`,
    [limit]
  );
  return Promise.all(rows.map(async (row) => ({
    ...row,
    secret: (await toRowWithSecret(row)).secret,
  })));
}

export async function claimPendingRetries(limit = 20) {
  return withTransaction(async (client) => {
    const { rows: pending } = await client.query(
      `SELECT wd.id
       FROM webhook_deliveries wd
       WHERE wd.status = 'pending_retry' AND wd.next_retry_at <= NOW()
       ORDER BY wd.next_retry_at ASC
       LIMIT $1
       FOR UPDATE OF wd SKIP LOCKED`,
      [limit]
    );

    if (pending.length === 0) {
      return [];
    }

    const ids = pending.map(row => row.id);
    const { rows } = await client.query(
      `UPDATE webhook_deliveries wd
       SET status = 'in_progress',
           locked_at = NOW()
       FROM webhooks w
       WHERE wd.id = ANY($1::int[])
         AND w.id = wd.webhook_id
       RETURNING wd.id, wd.webhook_id, wd.event, wd.payload, wd.retry_count,
                 wd.signing_secret_encrypted, wd.signing_secret_iv, wd.signing_secret_tag,
                 w.url, w.secret, w.secret_encrypted, w.secret_iv, w.secret_tag,
                 w.home_id, w.active`,
      [ids]
    );

    return Promise.all(rows.map(async (row) => ({
      ...row,
      secret: (await toRowWithSecret(row, client)).secret,
    })));
  });
}

export async function countRetryQueueSize() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM webhook_deliveries
     WHERE status IN ('pending_retry', 'in_progress')`
  );
  return rows[0]?.count || 0;
}

export async function updateDeliveryForRetry(id, retryCount, nextRetryAt) {
  await pool.query(
    `UPDATE webhook_deliveries
     SET retry_count = $2, next_retry_at = $3, status = 'pending_retry'
     WHERE id = $1`,
    [id, retryCount, nextRetryAt]
  );
}

export async function markDeliverySucceeded(id, statusCode, responseMs) {
  await pool.query(
    `UPDATE webhook_deliveries
     SET status = 'delivered', status_code = $2, response_ms = $3, error = NULL, next_retry_at = NULL
     WHERE id = $1`,
    [id, statusCode, responseMs]
  );
}

export async function markDeliveryFailed(id, error = null) {
  await pool.query(
    `UPDATE webhook_deliveries
     SET status = 'failed',
         error = COALESCE($2, error),
         next_retry_at = NULL,
         locked_at = NULL
     WHERE id = $1`,
    [id, error]
  );
}

export async function markDeliveryInProgress(id) {
  await pool.query(
    `UPDATE webhook_deliveries SET status = 'in_progress', locked_at = NOW() WHERE id = $1`,
    [id]
  );
}

/**
 * Reset deliveries stuck in 'in_progress' for more than 10 minutes back to
 * 'pending_retry' so the next poll can reattempt them. Handles the case where
 * the process crashed during an HTTP fetch after marking the row in_progress.
 */
export async function rescueStuckInProgress() {
  const { rowCount } = await pool.query(
    `UPDATE webhook_deliveries
     SET status = 'pending_retry',
         next_retry_at = NOW(),
         locked_at = NULL
     WHERE status = 'in_progress'
       AND locked_at < NOW() - INTERVAL '10 minutes'`
  );
  return rowCount;
}
