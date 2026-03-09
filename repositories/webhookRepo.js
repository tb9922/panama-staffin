import { pool } from '../db.js';

const SAFE_COLS = 'id, home_id, url, events, active, created_at, updated_at';

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
    'SELECT * FROM webhooks WHERE home_id = $1 AND active = true AND $2 = ANY(events)',
    [homeId, event]
  );
  return rows;
}

export async function create(homeId, data) {
  const { rows } = await pool.query(
    `INSERT INTO webhooks (home_id, url, secret, events, active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${SAFE_COLS}`,
    [homeId, data.url, data.secret, data.events, data.active !== false]
  );
  return rows[0];
}

export async function update(id, homeId, data) {
  const { rows } = await pool.query(
    `UPDATE webhooks SET url = $3, secret = $4, events = $5, active = $6, updated_at = NOW()
     WHERE id = $1 AND home_id = $2
     RETURNING ${SAFE_COLS}`,
    [id, homeId, data.url, data.secret, data.events, data.active]
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
    `SELECT wd.* FROM webhook_deliveries wd
     JOIN webhooks w ON w.id = wd.webhook_id
     WHERE wd.webhook_id = $1 AND w.home_id = $2
     ORDER BY wd.delivered_at DESC
     LIMIT $3`,
    [webhookId, homeId, limit]
  );
  return rows;
}
