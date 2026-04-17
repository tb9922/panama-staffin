import { pool } from '../db.js';

export async function listReadKeys(userId, homeId, client = pool) {
  const { rows } = await client.query(
    `SELECT notification_key, read_at
       FROM user_notification_reads
      WHERE user_id = $1 AND home_id = $2`,
    [userId, homeId],
  );
  return rows;
}

export async function markRead(userId, homeId, notificationKey, client = pool) {
  await client.query(
    `INSERT INTO user_notification_reads (user_id, home_id, notification_key, read_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, home_id, notification_key)
     DO UPDATE SET read_at = EXCLUDED.read_at`,
    [userId, homeId, notificationKey],
  );
}

export async function markManyRead(userId, homeId, notificationKeys, client = pool) {
  if (!Array.isArray(notificationKeys) || notificationKeys.length === 0) return;
  const uniqueKeys = [...new Set(notificationKeys.filter(Boolean))];
  if (!uniqueKeys.length) return;
  await client.query(
    `INSERT INTO user_notification_reads (user_id, home_id, notification_key, read_at)
     SELECT $1, $2, key, NOW()
       FROM UNNEST($3::TEXT[]) AS key
     ON CONFLICT (user_id, home_id, notification_key)
     DO UPDATE SET read_at = EXCLUDED.read_at`,
    [userId, homeId, uniqueKeys],
  );
}
