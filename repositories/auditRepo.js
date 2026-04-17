import { pool, withTransaction } from '../db.js';

async function setAuditMutationFlag(client, settingName) {
  await client.query(`SELECT set_config($1, 'on', true)`, [settingName]);
}

export async function log(action, homeSlug, username, details, client) {
  const conn = client || pool;
  const detailsValue = details != null ? JSON.stringify(details) : null;
  await conn.query(
    `INSERT INTO audit_log (action, home_slug, user_name, details) VALUES ($1,$2,$3,$4)`,
    [action, homeSlug || null, username || null, detailsValue]
  );
}

export async function getRecent(limit = 100) {
  const { rows } = await pool.query(
    `SELECT id, ts, action, home_slug, user_name, details
       FROM audit_log
      ORDER BY ts DESC
      LIMIT $1`,
    [limit]
  );
  return rows.map(r => ({
    ...r,
    ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts,
  }));
}

export async function countOlderThan(days, homeSlug) {
  const { rows } = homeSlug
    ? await pool.query(
        `SELECT COUNT(*)::int AS count FROM audit_log WHERE ts < NOW() - INTERVAL '1 day' * $1 AND home_slug = $2`,
        [days, homeSlug])
    : await pool.query(
        `SELECT COUNT(*)::int AS count FROM audit_log WHERE ts < NOW() - INTERVAL '1 day' * $1`,
        [days]);
  return rows[0].count;
}

export async function purgeOlderThan(days, homeSlug, client) {
  if (!client) {
    return withTransaction((tx) => purgeOlderThan(days, homeSlug, tx));
  }

  await setAuditMutationFlag(client, 'app.audit_log_allow_delete');
  const { rowCount } = homeSlug
    ? await client.query(
        `DELETE FROM audit_log WHERE ts < NOW() - INTERVAL '1 day' * $1 AND home_slug = $2`,
        [days, homeSlug])
    : await client.query(
        `DELETE FROM audit_log WHERE ts < NOW() - INTERVAL '1 day' * $1`,
        [days]);
  return rowCount;
}

export async function replaceInDetails({ homeSlug = null, findText, replacement, client }) {
  if (!findText) return 0;
  if (!client) {
    return withTransaction((tx) => replaceInDetails({ homeSlug, findText, replacement, client: tx }));
  }

  await setAuditMutationFlag(client, 'app.audit_log_allow_update');
  const { rowCount } = await client.query(
    `UPDATE audit_log
        SET details = REPLACE(details, $1, $2)
      WHERE (home_slug = $3 OR (home_slug IS NULL AND $3 IS NULL))
        AND details LIKE '%' || $1 || '%'`,
    [findText, replacement, homeSlug || null],
  );
  return rowCount;
}

export async function getByHome(homeSlug, limit = 100) {
  const { rows } = await pool.query(
    `SELECT id, ts, action, home_slug, user_name, details
       FROM audit_log
      WHERE home_slug = $1
      ORDER BY ts DESC
      LIMIT $2`,
    [homeSlug, limit]
  );
  return rows.map(r => ({
    ...r,
    ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts,
  }));
}

export async function getByHomeSlugs(slugs, limit = 100) {
  if (!slugs || slugs.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id, ts, action, home_slug, user_name, details
       FROM audit_log
      WHERE home_slug = ANY($1)
      ORDER BY ts DESC
      LIMIT $2`,
    [slugs, limit]
  );
  return rows.map(r => ({
    ...r,
    ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts,
  }));
}

export async function search({ homeSlug = null, homeSlugs = null, action = '', userName = '', dateFrom = '', dateTo = '', limit = 100, offset = 0 }) {
  if (!homeSlug && Array.isArray(homeSlugs) && homeSlugs.length === 0) {
    return { rows: [], total: 0 };
  }

  const params = [];
  const where = [];
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (homeSlug) where.push(`home_slug = ${addParam(homeSlug)}`);
  else if (Array.isArray(homeSlugs)) where.push(`home_slug = ANY(${addParam(homeSlugs)})`);

  if (action) where.push(`action ILIKE ${addParam(`%${action}%`)}`);
  if (userName) where.push(`user_name ILIKE ${addParam(`%${userName}%`)}`);
  if (dateFrom) where.push(`ts >= ${addParam(`${dateFrom}T00:00:00Z`)}`);
  if (dateTo) where.push(`ts < (${addParam(dateTo)}::date + INTERVAL '1 day')`);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limitParam = addParam(Math.min(limit, 10000));
  const offsetParam = addParam(Math.max(offset, 0));

  const { rows } = await pool.query(
    `SELECT id, ts, action, home_slug, user_name, details, COUNT(*) OVER() AS _total
       FROM audit_log
       ${whereSql}
      ORDER BY ts DESC
      LIMIT ${limitParam}
     OFFSET ${offsetParam}`,
    params,
  );

  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return {
    rows: rows.map((row) => {
      const { _total, ...rest } = row;
      return {
        ...rest,
        ts: rest.ts instanceof Date ? rest.ts.toISOString() : rest.ts,
      };
    }),
    total,
  };
}

/**
 * Export HR audit entries for a home within a date range.
 * Explicit column list — no SELECT * — so future columns don't auto-leak.
 */
export async function exportHrByHome(homeSlug, from, to) {
  const { rows } = await pool.query(
    `SELECT id, ts, action, home_slug, user_name, details
       FROM audit_log
      WHERE home_slug = $1 AND action LIKE 'hr_%' AND ts >= $2 AND ts <= $3
      ORDER BY ts DESC
      LIMIT 50000`,
    [homeSlug, from, to]
  );
  return rows.map(r => ({
    ...r,
    ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts,
  }));
}

export async function exportHrByHomeChunk(homeSlug, from, to, { limit = 1000, cursorTs = null, cursorId = null } = {}) {
  const params = [homeSlug, from, to];
  let cursorSql = '';
  if (cursorTs && cursorId != null) {
    params.push(cursorTs, cursorId);
    cursorSql = ` AND (ts, id) < ($4, $5)`;
  }
  params.push(limit);
  const limitParam = `$${params.length}`;

  const { rows } = await pool.query(
    `SELECT id, ts, action, home_slug, user_name, details
       FROM audit_log
      WHERE home_slug = $1
        AND action LIKE 'hr_%'
        AND ts >= $2
        AND ts <= $3${cursorSql}
      ORDER BY ts DESC, id DESC
      LIMIT ${limitParam}`,
    params
  );

  return rows.map((row) => ({
    ...row,
    ts: row.ts instanceof Date ? row.ts.toISOString() : row.ts,
  }));
}
