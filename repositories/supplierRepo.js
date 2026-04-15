import { pool } from '../db.js';

const COLS = `
  id,
  home_id,
  name,
  vat_number,
  default_category,
  aliases,
  active,
  version,
  created_by,
  created_at,
  updated_at,
  deleted_at
`;

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    home_id: row.home_id,
    name: row.name,
    vat_number: row.vat_number || null,
    default_category: row.default_category || null,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    active: row.active,
    version: row.version != null ? parseInt(row.version, 10) : 0,
    created_by: row.created_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at || null,
  };
}

export async function listByHome(homeId, { q, activeOnly = false } = {}, client) {
  const conn = client || pool;
  const params = [homeId];
  let sql = `SELECT ${COLS} FROM suppliers WHERE home_id = $1 AND deleted_at IS NULL`;
  if (activeOnly) sql += ' AND active = TRUE';
  if (q) {
    params.push(`%${q.trim().toLowerCase()}%`);
    sql += ` AND (
      LOWER(name) LIKE $${params.length}
      OR EXISTS (
        SELECT 1
          FROM jsonb_array_elements_text(aliases) alias
         WHERE LOWER(alias.value) LIKE $${params.length}
      )
    )`;
  }
  sql += ' ORDER BY LOWER(name), id';
  const { rows } = await conn.query(sql, params);
  return rows.map(shape);
}

export async function findById(id, homeId, client, { forUpdate = false } = {}) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS}
       FROM suppliers
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`,
    [id, homeId]
  );
  return shape(rows[0]);
}

export async function findByNormalizedNameOrAlias(homeId, normalizedName, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS}
       FROM suppliers
      WHERE home_id = $1
        AND deleted_at IS NULL
        AND (
          LOWER(TRIM(name)) = $2
          OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements_text(aliases) alias
             WHERE LOWER(TRIM(alias.value)) = $2
          )
        )
      ORDER BY active DESC, id ASC
      LIMIT 1`,
    [homeId, normalizedName]
  );
  return shape(rows[0]);
}

export async function create(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO suppliers
       (home_id, name, vat_number, default_category, aliases, active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING ${COLS}`,
    [
      homeId,
      data.name,
      data.vat_number || null,
      data.default_category || null,
      JSON.stringify(data.aliases || []),
      data.active ?? true,
      data.created_by || null,
    ]
  );
  return shape(rows[0]);
}

export async function update(id, homeId, data, client, version) {
  const conn = client || pool;
  const params = [id, homeId];
  const fields = [];
  const settable = ['name', 'vat_number', 'default_category', 'aliases', 'active'];
  for (const key of settable) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    params.push(key === 'aliases' ? JSON.stringify(data[key] || []) : (data[key] ?? null));
    fields.push(`${key} = $${params.length}`);
  }
  if (fields.length === 0) return findById(id, homeId, client);
  fields.push('updated_at = NOW()', 'version = version + 1');
  let sql = `UPDATE suppliers SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) {
    params.push(version);
    sql += ` AND version = $${params.length}`;
  }
  sql += ` RETURNING ${COLS}`;
  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return shape(rows[0]);
}

export async function softDelete(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE suppliers
        SET deleted_at = NOW(),
            active = FALSE,
            updated_at = NOW(),
            version = version + 1
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL
    RETURNING ${COLS}`,
    [id, homeId]
  );
  return shape(rows[0]);
}

export async function repointFinanceRows(homeId, sourceId, targetId, client) {
  const conn = client || pool;
  await conn.query(
    `UPDATE finance_expenses
        SET supplier_id = $3,
            supplier = COALESCE(
              (SELECT name FROM suppliers WHERE id = $3 AND home_id = $1 AND deleted_at IS NULL),
              supplier
            )
      WHERE home_id = $1
        AND supplier_id = $2
        AND deleted_at IS NULL`,
    [homeId, sourceId, targetId]
  );
  await conn.query(
    `UPDATE finance_payment_schedule
        SET supplier_id = $3,
            supplier = COALESCE(
              (SELECT name FROM suppliers WHERE id = $3 AND home_id = $1 AND deleted_at IS NULL),
              supplier
            )
      WHERE home_id = $1
        AND supplier_id = $2
        AND deleted_at IS NULL`,
    [homeId, sourceId, targetId]
  );
}
