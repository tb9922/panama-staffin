import { pool } from '../db.js';

/* Explicit column list — no SELECT * — so future columns don't auto-leak to API consumers. */
const HOME_COLS = 'id, slug, name, config, annual_leave, created_at, updated_at, deleted_at';

function shapeHome(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    config: row.config,
    annual_leave: row.annual_leave,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

/**
 * Find a home by its integer primary key.
 * Returns null if not found.
 * @param {number} id
 */
export async function findById(id, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${HOME_COLS} FROM homes WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return shapeHome(rows[0]) || null;
}

/**
 * Find a home by ID without filtering soft-deleted rows.
 * Used only by platform admin CRUD where deleted status must be checked explicitly.
 */
export async function findByIdIncludingDeleted(id, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${HOME_COLS} FROM homes WHERE id = $1`,
    [id],
  );
  return shapeHome(rows[0]) || null;
}

/**
 * Find a home by its slug (path-safe name, e.g. "Oakwood_Care_Home").
 * Returns null if not found.
 * @param {string} slug
 */
export async function findBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT ${HOME_COLS} FROM homes WHERE slug = $1 AND deleted_at IS NULL`,
    [slug]
  );
  return shapeHome(rows[0]) || null;
}

/**
 * Lock + fetch a home row within a transaction (SELECT ... FOR UPDATE).
 * The second concurrent save blocks until the first commits, then sees
 * the new updated_at and correctly 409s via optimistic locking.
 */
export async function findBySlugForUpdate(slug, client) {
  const { rows } = await client.query(
    `SELECT ${HOME_COLS} FROM homes WHERE slug = $1 AND deleted_at IS NULL FOR UPDATE`,
    [slug]
  );
  return shapeHome(rows[0]) || null;
}

/**
 * List all homes with config metadata for the homes list endpoint.
 * Returns [{id, slug, name, beds, type}]
 */
export async function listAll() {
  const { rows } = await pool.query(
    'SELECT id, slug, name, config FROM homes WHERE deleted_at IS NULL ORDER BY name'
  );
  return rows.map(r => ({
    id: r.slug,
    name: r.config?.home_name || r.name,
    beds: r.config?.registered_beds,
    type: r.config?.care_type,
  }));
}

/**
 * List all homes with integer IDs for user access management.
 * Returns [{id (integer PK), name}]
 */
export async function listAllWithIds() {
  const { rows } = await pool.query(
    'SELECT id, slug, name, config FROM homes WHERE deleted_at IS NULL ORDER BY name'
  );
  return rows.map(r => ({
    id: r.id,
    slug: r.slug,
    name: r.config?.home_name || r.name,
  }));
}

/**
 * Upsert a home by slug. Creates it if it doesn't exist.
 * Returns the home row.
 * @param {string} slug
 * @param {string} name
 * @param {object} configObj
 * @param {object} [annualLeave]
 * @param {object} [client] Optional transaction client
 */
export async function upsert(slug, name, configObj, annualLeave, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO homes (slug, name, config, annual_leave)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE SET
       name = EXCLUDED.name,
       config = EXCLUDED.config,
       annual_leave = EXCLUDED.annual_leave,
       updated_at = NOW()
     RETURNING ${HOME_COLS}`,
    [slug, name, JSON.stringify(configObj), JSON.stringify(annualLeave || {})]
  );
  return shapeHome(rows[0]);
}

/**
 * Update the config JSONB for a home.
 * @param {number} homeId
 * @param {object} configObj
 * @param {object} [client]
 * @param {string} [clientUpdatedAt]
 */
export async function updateConfig(homeId, configObj, client, clientUpdatedAt) {
  const conn = client || pool;
  const params = [JSON.stringify(configObj), homeId];
  let sql = 'UPDATE homes SET config = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL';
  if (clientUpdatedAt) {
    params.push(clientUpdatedAt);
    sql += ` AND date_trunc('milliseconds', updated_at) = $${params.length}::timestamptz`;
  }
  sql += ' RETURNING updated_at';
  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && clientUpdatedAt) return null;
  return rows[0]?.updated_at ? rows[0].updated_at.toISOString() : null;
}

/**
 * Update only the training_types config key.
 * Optionally guards on the caller's last-seen updated_at to prevent stale overwrites.
 * Returns the fresh updated_at ISO string, or null on stale conflict.
 */
export async function updateTrainingTypesConfig(homeId, trainingTypes, client, clientUpdatedAt) {
  const conn = client || pool;
  const params = [JSON.stringify(trainingTypes), homeId];
  let sql = `
    UPDATE homes
    SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{training_types}', $1::jsonb, true),
        updated_at = NOW()
    WHERE id = $2 AND deleted_at IS NULL`;

  if (clientUpdatedAt) {
    params.push(clientUpdatedAt);
    sql += ` AND date_trunc('milliseconds', updated_at) = $${params.length}::timestamptz`;
  }

  sql += ' RETURNING updated_at';
  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && clientUpdatedAt) return null;
  return rows[0]?.updated_at ? rows[0].updated_at.toISOString() : null;
}

/**
 * Update the annual_leave JSONB for a home.
 * @param {number} homeId
 * @param {object} alObj
 * @param {object} [client]
 */
export async function updateAnnualLeave(homeId, alObj, client) {
  const conn = client || pool;
  await conn.query(
    'UPDATE homes SET annual_leave = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL',
    [JSON.stringify(alObj || {}), homeId]
  );
}

/**
 * Check if an active (non-deleted) home with the given slug exists.
 */
export async function slugExistsActive(slug) {
  const { rows } = await pool.query(
    'SELECT 1 FROM homes WHERE slug = $1 AND deleted_at IS NULL LIMIT 1',
    [slug]
  );
  return rows.length > 0;
}

/**
 * Create a new home with explicit INSERT (never upsert).
 * @param {string} slug
 * @param {string} name
 * @param {object} configObj
 * @param {object} client - transaction client (required)
 */
export async function create(slug, name, configObj, client) {
  const { rows } = await client.query(
    `INSERT INTO homes (slug, name, config, annual_leave)
     VALUES ($1, $2, $3, '{}')
     RETURNING ${HOME_COLS}`,
    [slug, name, JSON.stringify(configObj)]
  );
  return shapeHome(rows[0]);
}

/**
 * List all homes with staff/user counts for platform admin.
 * @param {boolean} includeDeleted
 */
export async function listAllWithStats(includeDeleted = false) {
  const filter = includeDeleted ? '' : 'WHERE h.deleted_at IS NULL';
  const { rows } = await pool.query(
    `SELECT h.id, h.slug, h.name, h.config, h.deleted_at, h.updated_at,
       (SELECT COUNT(*)::int FROM staff s WHERE s.home_id = h.id AND s.deleted_at IS NULL) AS staff_count,
       (SELECT COUNT(DISTINCT username)::int FROM user_home_roles uhr WHERE uhr.home_id = h.id) AS user_count
     FROM homes h ${filter}
     ORDER BY h.name`
  );
  return rows.map(r => ({
    id: r.id,
    slug: r.slug,
    name: r.config?.home_name || r.name,
    beds: r.config?.registered_beds,
    careType: r.config?.care_type,
    cycleStartDate: r.config?.cycle_start_date,
    scanIntakeEnabled: Boolean(r.config?.scan_intake_enabled),
    scanIntakeTargets: Array.isArray(r.config?.scan_intake_targets) ? r.config.scan_intake_targets : [],
    scanOcrEngine: r.config?.scan_ocr_engine || 'paddleocr',
    staffCount: r.staff_count,
    userCount: r.user_count,
    deletedAt: r.deleted_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Soft-delete a home. Must be called within a transaction.
 */
export async function softDelete(id, client) {
  await client.query(
    'UPDATE homes SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
}

/**
 * Update the name column for a home.
 */
export async function updateName(id, name, client) {
  const conn = client || pool;
  await conn.query(
    'UPDATE homes SET name = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL',
    [name, id]
  );
}

/**
 * Count active (non-deleted) homes. Accepts client for transaction use.
 */
export async function countActive(client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    "SELECT COUNT(*)::int AS count FROM homes WHERE deleted_at IS NULL"
  );
  return rows[0].count;
}
